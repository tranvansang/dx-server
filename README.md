# dx-server - modern, unopinionated, and satisfactory server

## Install
```bash
yarn add dx-server jchain
```

## Usage

Check below sample with comment for more details.

Simple server

```javascript
import {Server} from 'node:http'
import chain from 'jchain'
import dxServer, {getReq, getRes, router, setHtml, setText,} from 'dx-server'

new Server().on('request', (req, res) => chain(
		dxServer(req, res),
		async next => {
			try {
				getRes().setHeader('Cache-Control', 'no-cache')
				console.log(getReq().method, getReq().url)
				await next()
			} catch (e) {
				console.error(e)
				setHtml('internal server error', {status: 500})
			}
		},
		router.get({
			'/'() {setHtml('hello world')},
			'/health'() {setText('ok')}
		}),
		() => setHtml('not found', {status: 404}),
	)()
).listen(3000, () => console.log('server is listening at 3000'))
```

File server:

```javascript
import {Server} from 'node:http'
import chain from 'jchain'
import dxServer, {chainStatic, setHtml} from 'dx-server'
import {resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

new Server().on('request', (req, res) => chain(
		dxServer(req, res),
		chainStatic('/', {root: resolve(dirname(fileURLToPath(import.meta.url)), 'public')}),
		() => setHtml('not found', {status: 404}),
	)()
).listen(3000, () => console.log('server is listening at 3000'))
```

More complex server with express.
This sample additionally requires: `yarn install express morgan`


```javascript
import {Server} from 'node:http'
import {promisify} from 'node:util'
import chain from 'jchain'
import dxServer, {
	getReq, getRes,
	getBuffer, getJson, getRaw, getText, getUrlEncoded, getQuery,
	setHtml, setJson, setText, setBuffer, setRedirect, setNodeStream, setWebStream, setFile,
	router, connectMiddlewares, chainStatic, makeDxContext
} from 'dx-server'
import {expressApp} from 'dx-server/express'
import express from 'express'
import morgan from 'morgan'

// it is best practice to create custom error class for non-system error
class ServerError extends Error {
	name = 'ServerError'

	constructor(message, status = 400, code = 'unknown') {
		super(message)
		this.status = status
		this.code = code
	}
}

const authContext = makeDxContext(async () => {
	if (getReq().headers.authorization) return {id: 1, name: 'joe (private)'}
})

const requireAuth = () => {
	if (!authContext.value) throw new ServerError('unauthorized', 401, 'unauthorized')
}

const serverChain = chain(
	next => {
		// this is the difference between express and dx-server
		// req, res can be accessed from anywhere via context which uses NodeJS's AsyncLocalStorage under the hood
		getRes().setHeader('Cache-Control', 'no-cache')
		return next() // must return or await
	},
	async next => {// global error catching for all following middlewares
		try {
			await next()
		} catch (e) {// only app error message should be shown to user
			if (e instanceof ServerError) setHtml(`${e.message} (code: ${e.code})`, {status: e.status})
			else {// report system error
				console.error(e)
				setHtml('internal server error (code: internal)', {status: 500})
			}
		}
	},
	connectMiddlewares(
		morgan('common'),
		// cors(),
	),
	await expressApp(app => {// any express feature can be used. This requires express installed, with for e.g., `yarn add express`
		app.set('trust proxy', true)
		if (process.env.NODE_ENV !== 'production') app.set('json spaces', 2)
		app.use('/public', express.static('public'))
	}),
	authContext.chain(), // chain context will set the context value to authContext.value in every request
	router.post('/api/*', async ({next}) => {// example of catching error for all /api/* routes
		try {
			await next()
		} catch (e) {
			if (e instanceof ServerError) setJson({// only app error message should be shown to user
				error: e.message,
				code: e.code,
			}, {status: e.status})
			else {// report system error
				console.error(e)
				setJson({
					message: 'internal server error',
					code: 'internal'
				}, {status: 500})
			}
		}
	}),
	router.post({
		'/api/sample-public-api'() { // sample POST router
			setJson({name: 'joe'})
		},
		'/api/me'() { // sample private router
			requireAuth()
			setJson({name: authContext.value.name})
		},
	}),
	router.get('/', () => setHtml('ok')), // router.method() accepts 2 formats
	router.get('/health', () => setText('ok')),
	() => { // not found router
		throw new ServerError('not found', 404, 'not_found')
	},
)

const tcpServer = new Server()
	.on('request', async (req, res) => {
		try {
			await chain(
				dxServer(req, res, {jsonBeautify: process.env.NODE_ENV !== 'production'}), // basic dx-server context
				serverChain,
			)()
		} catch (e) {
			console.error(e)
			res.end()
		}
	})

await promisify(tcpServer.listen.bind(tcpServer))(3000)
console.log('server is listening at 3000')
```

## Note:

`getBuffer, getJson, getRaw, getText, getUrlEncoded, getQuery` are all asynchronous functions.
The associated results are calculated in the first time they are called and cached for subsequent calls.

If you want to get these values synchronously, chain it, like follows:
```javascript
import {getJson} from 'dx-server'

chain(
	getJson.chain(/*option*/), // json body is parsed and stored in context in every request
	next => {
		console.log(getJson.value) // json body can be accessed synchronously
		return next()
	}
)
```

Context can be created using `makeDxContext` function:

```javascript
import {makeDxContext} from 'dx-server'

const authContext = makeDxContext(() => {
	if (getReq().headers.authorization) return {id: 1, name: 'joe (authorized)'}
})
const requireAuth = () => {
	if (!authContext.value) throw new Error('unauthorized')
}
chain(
	authContext.chain(),
	next => {
		requireAuth()
		return next()
	}
)
// or await authContext() to lazy load the context and don't require chaining authContext.chain()
chain(
	async next => {
		console.log(await authContext())
		return next()
	}
)
```

# API References
All exported APIs:
```javascript
import dxServer, {
	getReq, getRes, getBuffer, getJson, getRaw, getText, getUrlEncoded, getQuery,
	setHtml, setJson, setText, setBuffer, setRedirect, setNodeStream, setWebStream, setFile,
	router, connectMiddlewares, chainStatic, makeDxContext
} from 'dx-server'
import {expressApp, expressRouter} from 'dx-server/express' // requires express installed
import {
	setBufferBodyDefaultOptions,
	bufferFromReq, jsonFromReq, rawFromReq, textFromReq, urlEncodedFromReq, queryFromReq,
} from 'dx-server/helpers'
```

## Basic
```javascript
import dxServer, {
	getReq, getRes, getBuffer, getJson, getRaw, getText, getUrlEncoded, getQuery,
	setHtml, setJson, setText, setBuffer, setRedirect, setNodeStream, setWebStream, setFile,
	makeDxContext
} from 'dx-server'
```

- `getReq()`, `getRes()`: get request and response objects from anywhere.

- `getBuffer()`, `getJson()`, `getRaw()`, `getText()`, `getUrlEncoded()`, `getQuery()`: get parsed request body, raw body, text body, url encoded body, query string from anywhere.
These are DX context object, can be used as follows:
	- `const json = await getJson()`: lazily load the context, once loaded, it is cached for subsequent calls.
No chaining is required.
  - Chain it to get the value synchronously: `chain(getJson.chain(), next => console.log(getJson.value))`. Note that the value is calculated in every request.
- `makeDxContext(fn)`: create a DX context object.

- `setHtml`, `setJson`, `setText`, `setBuffer`, `setRedirect`, `setNodeStream`, `setWebStream`, `setFile`: set response body.

- `connectMiddlewares(...middlewares)`: connect middlewares. For example:
```javascript
import {connectMiddlewares} from 'dx-server'
import morgan from 'morgan'
import cors from 'cors'

connectMiddlewares(
	morgan('common'),
	cors(),
)
```

- `chainStatic(path, options)`: serve static files. For example:
```javascript
import {chainStatic} from 'dx-server'
import {resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

chain(
	chainStatic('/assets', {root: resolve(dirname(fileURLToPath(import.meta.url)), 'public')})
)
```

## Routing
```javascript
import {router} from 'dx-server'
```

- `router.get`, `router.post`, `router.put`, `router.delete`, `router.patch`, `router.head`, `router.options`, `router.connect`, `router.trace`: create router.
	These functions accept 2 formats:
	- `router.get(routes: {[pattern: string]: Route}, options: RouterOptions)`: create multiple routes.
	- `router.get(pattern: string, handler: Route, options: RouterOptions)`: create route for GET method.

- `router.all(...)`: same as `router.get()` but for any method.
- `router.method()`: create router with custom method. Similar to `router.get()`, this function accepts 2 formats.
	- `router.method(method: string, routes: {[pattern: string]: Route}, options: RouterOptions)`: create multiple routes.
	- `router.method(method: string, pattern: string, handler: Route, options: RouterOptions)`: create route for `method` method.

`RouterOptions` is defined as follows:
```typescript
interface RouterOptions {
	prefix?: string
	sensitive?: string
}
```

Patterns are matched using [URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern).
This does not always match the same as ExpressJS.
For example, to match any path prefixed with `/api/`, use `/api/*`.
Note the following:
- `''` matches nothing.
- `'/'` matches both https://example.com and https://example.com/.
- `'/foo'` matches https://example.com/foo but not https://example.com/foo/.
- `'/foo/'` matches https://example.com/foo/ but not https://example.com/foo.

`Route` is defined as follows:
```typescript
interface RouteContext {
	matched: URLPatternResult // result returned from URLPattern.exec()
	params: Record<string, string>
	next(): any
}
type Route = (context: RouteContext) => any
```

## Helpers
```javascript
import {
	setBufferBodyDefaultOptions,
	bufferFromReq, jsonFromReq, rawFromReq, textFromReq, urlEncodedFromReq, queryFromReq,
} from 'dx-server/helpers'
```

Helpers are all pure functions, and do not rely on any context.
These functions are independent of the context and can be used anywhere, even outside of this package.
They require request and response objects to be passed.

## ExpressJS
```javascript
import {expressApp, expressRouter} from 'dx-server/express' // requires express installed

chain(
	await expressApp(app => {// any express feature can be used. This requires express installed, with for e.g., `yarn add express`
		app.set('trust proxy', true)
		if (process.env.NODE_ENV !== 'production') app.set('json spaces', 2)
		app.use('/public', express.static('public'))
	}),
	expressRouter(router => {
		router.use(cors())
	}),
)
```

## Other functionalities
- Download file: set the [Content-Disposition](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition) header.
- Upload file: recommend [busboy](https://www.npmjs.com/package/busboy) package.
- Cookie: recommend [cookie](https://www.npmjs.com/package/cookie) package.
