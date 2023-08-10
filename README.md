# dx-server - modern, unopinionated, and satisfactory server

## Install
```bash
yarn add dx-server jchain
```

## Usage

Check below sample with comment for more details.

```javascript
import {Server} from 'http'
import {promisify} from 'util'
import {
	requestContext, responseContext,

	expressContext, setHtml, setJson,

	bufferBodyContext,
	jsonBodyContext,
	queryContext,
	rawBodyContext,
	textBodyContext,
	urlencodedBodyContext,

	router,
	catchApiError, catchError, notFound, notFoundApi,
	expressApp,
} from 'dx-server'

const tcpServer = new Server()
	.on('request', async (req, res) => {
	try {
		await chain(
			requestContext.chain(req), // required for most middlewares
			responseContext.chain(res), // required for most middlewares
			expressContext.chain({jsonBeautify: true}), // allows to use setHtml, setJson, setRaw, setBuffer, setFile, setRedirect, etc.
			bufferBodyContext.chain(), // use raw buffer body as Buffer use bufferBodyContext.value. This is required for jsonBodyContext, urlencodedBodyContext, textBodyContext, rawBodyContext
			jsonBodyContext.chain(), // to get body parsed as json use jsonBodyContext.value. Only available if content-type is application/json
			urlencodedBodyContext.chain(), // to get body parsed as urlencoded use urlencodedBodyContext.value. Only available if content-type is application/x-www-form-urlencoded
			textBodyContext.chain(), // to get body parsed as text use textBodyContext.value. Only available if content-type is text/plain
			rawBodyContext.chain(), // to get body as raw use rawBodyContext.value. Only available if content-type is application/octet-stream
			queryContext.chain(), // to get query params use queryContext.value. Query is parsed via 'qs' package. If no query, return empty object {}
			next => {
				// this is the difference between express and dx-server
				// req, res can be accessed from anywhere via context which uses NodeJS's AsyncLocalStorage under the hood
				responseContext.value.setHeader('cache-control', 'no-cache')
				next()
			},
			async next => {
				// global error catching for all following middlewares
				try {
					await next()
				} catch (e) {
					console.error(e)
					setHtml('internal server error', {status: 500})
				}
			},
			expressApp(app => {
				// any express feature can be used
				// required express installed, with for e.g., `yarn add express`
				app.use('/photos', express.static('photos'))
			}),
			// example of catching error for all /api/* routes
			router.post({
				async '/api'({next}) {
					try {
						await next()
					} catch (e) {
						console.error(e)
						setJson({
							message: 'internal server error',
							code: 'internal_server_error'
						}, {status: 500})
					}
				}
			}, {end: false}), // note: {end: false} is required to match all /api/* routes. This option is passed directly to path-to-regexp
			router.post({
				'/api/me'() { // sample POST router
				setJson({name: 'joe'})
			}
			}),
			router.get({ // sample GET router
				'/'() {
					setHtml('ok')
				},
				'/health'() {
					setHtml('ok')
				}
			}),
			router.post({ // api not found router
				'/api'() {
					setJson({
						message: 'not found',
						code: 'not_found'
					}, {status: 404})
				}
			}, {end: false}),
			() => { // not found router
				setHtml('not found', {status: 404})
			},
		)()
	} catch (e) {
	console.error(e)
	}
})

const port = +(process.env.PORT ?? 3000)
await promisify(tcpServer.listen.bind(tcpServer))(port)
console.log(`server is listening at ${port}`)
```

## TODO
Until these middlewares are available as native dx-server middlewares, express middlewares can be used with `expressApp()`
- [ ] native static file serve, like 'static-serve'
- [ ] logger like morgan
- [ ] cookie, session
- [ ] cors
