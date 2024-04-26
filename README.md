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
		next => {
			getRes().setHeader('Cache-Control', 'no-cache')
			console.log(getReq().method, getReq().url)
			return next()
		},
		async next => {
			try {await next()} catch (e) {
				console.error(e)
				setHtml('internal server error (code: internal)', {status: 500})
			}
		},
		router.get({
			'/'() {setHtml('hello world')},
			'/health'() {setText('ok')}
		}),
		() => {setHtml('not found', {status: 404})},
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
	setHtml, setJson, setText, setBuffer, setRedirect, setNodeStream, setWebStream,
	router,
} from 'dx-server'
import {expressApp} from 'dx-server/express'
import express from 'express'
import morgan from 'morgan'
import {AsyncLocalStorage} from 'node:async_hooks'

// it is best practice to create custom error class for non-system error
class ServerError extends Error {
	name = 'ServerError'

	constructor(message, status = 400, code = 'unknown') {
		super(message)
		this.status = status
		this.code = code
	}
}

const authStorage = new AsyncLocalStorage()
const authChain = async next => {
	const auth = getReq().headers.authorization ? {id: 1, name: 'joe'} : undefined
	return authStorage.run(auth, next)
}

const requireAuth = () => {
	if (!authStorage.getStore()) throw new ServerError('unauthorized', 401, 'unauthorized')
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
	await expressApp(app => {// any express feature can be used. This requires express installed, with for e.g., `yarn add express`
		app.set('trust proxy', true)
		if (process.env.NODE_ENV !== 'production') app.set('json spaces', 2)
		app.use(morgan('common')) // in future, we will provide native implementation of express middlewares
		app.use('/public', express.static('public'))
	}),
	authChain,
	router.post({// example of catching error for all /api/* routes
		async '/api'({next}) {
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
		}
	}, {end: false}), // note: {end: false} is required to match all /api/* routes. This option is passed directly to path-to-regexp
	router.post({
		'/api/sample-public-api'() { // sample POST router
			setJson({name: 'joe'})
		},
		'/api/me'() { // sample private router
			requireAuth()
			setJson({name: authStorage.getStore().name})
		},
	}),
	router.get({ // sample GET router
		'/'() {
			setHtml('ok')
		},
		'/health'() {
			setHtml('ok')
		}
	}),
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
		}
	})

await promisify(tcpServer.listen.bind(tcpServer))(3000)
console.log('server is listening at 3000')
```

## TODO
Until these middlewares are available as native dx-server middlewares, express middlewares can be used with `expressApp()`
- [ ] native static file serve, like 'static-serve'
- [ ] logger like morgan
- [ ] cors

## Note:
	`getBuffer, getJson, getRaw, getText, getUrlEncoded, getQuery` are all synchronous functions.
The associated results are calculated in the first time they are called and cached for subsequent calls.

If you want to get these values synchronously, you can do as follows:
```javascript
import {AsyncLocalStorage} from 'node:async_hooks'
import {getJson} from 'dx-server'
const jsonStorage = new AsyncLocalStorage()

chain(
	async next => jsonStorage.run(await getJson(), next),
	next => {
		console.log(jsonContext.value) // json body can be accessed synchronously
		return next()
	}
)
```
