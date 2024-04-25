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
import {
	reqContext, resContext,
	dxContext, setHtml, setJson, setText,
	bufferBodyContext, jsonBodyContext, queryContext, rawBodyContext, textBodyContext, urlencodedBodyContext,
	router,
} from 'dx-server'

new Server().on('request', async (req, res) => {
	await chain(
		reqContext.chain(req),
		resContext.chain(res),
		dxContext.chain(),
		bufferBodyContext.chain(),
		jsonBodyContext.chain(),
		urlencodedBodyContext.chain(),
		textBodyContext.chain(),
		rawBodyContext.chain(),
		queryContext.chain(),
		next => {
			resContext.value.setHeader('Cache-Control', 'no-cache')
			console.log(reqContext.value.method, reqContext.value.url)
			next()
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
		() => {throw new Error('not found')},
	)()
}).listen(3000, () => console.log('server is listening at 3000'))
```

More complex server with express.
This sample additionally requires: `yarn install express morgan`


```javascript
import {Server} from 'node:http'
import {promisify} from 'node:util'
import chain from 'jchain'
import {
	makeContext, reqContext, resContext,

	dxContext,
	setHtml,
	setJson,
	setText,
	setBuffer,
	setRedirect,
	setNodeStream,
	setWebStream,

	bufferBodyContext,
	jsonBodyContext,
	queryContext,
	rawBodyContext,
	textBodyContext,
	urlencodedBodyContext,

	router
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

// makeContext is a convenient way to create context
const authContext = makeContext(() => {
	const req = reqContext.value
	// determine if user is authenticated
	// for e.g.
	if (req.headers.authorization) {
		return {id: 1, name: 'joe'}
	}
})

const requireAuth = () => {
	if (!authContext.value) throw new ServerError('unauthorized', 401, 'unauthorized')
}

const serverChain = chain(
	dxContext.chain({jsonBeautify: process.env.NODE_ENV !== 'production'}), // allows to use setHtml, setJson, setRaw, setBuffer, setFile, setRedirect, etc.
	bufferBodyContext.chain(), // use raw buffer body as Buffer use bufferBodyContext.value. This is required for jsonBodyContext, urlencodedBodyContext, textBodyContext, rawBodyContext
	jsonBodyContext.chain(), // to get body parsed as json use jsonBodyContext.value. Only available if content-type is application/json
	urlencodedBodyContext.chain(), // to get body parsed as urlencoded use urlencodedBodyContext.value. Only available if content-type is application/x-www-form-urlencoded
	textBodyContext.chain(), // to get body parsed as text use textBodyContext.value. Only available if content-type is text/plain
	rawBodyContext.chain(), // to get body as raw use rawBodyContext.value. Only available if content-type is application/octet-stream
	queryContext.chain(), // to get query params use queryContext.value. Query is parsed via 'qs' package. If no query, return empty object {}
	next => {
		// this is the difference between express and dx-server
		// req, res can be accessed from anywhere via context which uses NodeJS's AsyncLocalStorage under the hood
		resContext.value.setHeader('Cache-Control', 'no-cache')
		next()
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
	authContext.chain(),
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
			setJson({name: authContext.value.name})
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
				reqContext.chain(req), // required for most middlewares
				resContext.chain(res), // required for most middlewares
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
