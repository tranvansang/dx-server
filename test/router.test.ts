import {test} from 'node:test'
import {strictEqual} from 'node:assert/strict'
import {Server, request} from 'node:http'
import type {AddressInfo} from 'node:net'
import dxServer, {router, setText, setJson} from '../lib/index.js'
import type {Chainable} from '../lib/dx.js'

test('string form: GET match returns body, non-match falls through', async () => {
	const mw = router.get('/hi', () => setText('hello'))
	strictEqual((await call(mw, {path: '/hi'})).body, 'hello')

	const miss = await call(mw, {path: '/other'})
	strictEqual(miss.status, 404)
	strictEqual(miss.body, 'FALLBACK')
})

test('path params are exposed via matched.pathname.groups', async () => {
	const mw = router.get('/users/:id', ({matched}) => setJson(matched.pathname.groups))
	strictEqual((await call(mw, {path: '/users/42'})).body, '{"id":"42"}')
})

test('object form maps multiple patterns, unmatched falls through', async () => {
	const mw = router.get({'/a': () => setText('A'), '/b': () => setText('B')})
	strictEqual((await call(mw, {path: '/a'})).body, 'A')
	strictEqual((await call(mw, {path: '/b'})).body, 'B')
	strictEqual((await call(mw, {path: '/c'})).body, 'FALLBACK')
})

test('method filtering: post handler ignores GET, serves POST', async () => {
	const mw = router.post('/x', () => setText('posted'))
	strictEqual((await call(mw, {path: '/x', method: 'GET'})).body, 'FALLBACK')
	strictEqual((await call(mw, {path: '/x', method: 'POST'})).body, 'posted')
})

test('all() matches any method', async () => {
	const mw = router.all('/any', () => setText('any'))
	strictEqual((await call(mw, {path: '/any', method: 'GET'})).body, 'any')
	strictEqual((await call(mw, {path: '/any', method: 'POST'})).body, 'any')
	strictEqual((await call(mw, {path: '/any', method: 'PUT'})).body, 'any')
})

test('all() object form matches any method', async () => {
	const mw = router.all({'/z': () => setText('zed')})
	strictEqual((await call(mw, {path: '/z', method: 'DELETE'})).body, 'zed')
})

test('method(): string form filters by the named method', async () => {
	const mw = router.method('put', '/p', () => setText('put-ok'))
	strictEqual((await call(mw, {path: '/p', method: 'PUT'})).body, 'put-ok')
	strictEqual((await call(mw, {path: '/p', method: 'GET'})).body, 'FALLBACK')
})

test('method(): object form', async () => {
	const mw = router.method('delete', {'/d': () => setText('del')})
	strictEqual((await call(mw, {path: '/d', method: 'DELETE'})).body, 'del')
	strictEqual((await call(mw, {path: '/d', method: 'GET'})).body, 'FALLBACK')
})

test('prefix option: string form', async () => {
	const mw = router.get('/inner', () => setText('p'), {prefix: '/api'})
	strictEqual((await call(mw, {path: '/api/inner'})).body, 'p')
	strictEqual((await call(mw, {path: '/inner'})).body, 'FALLBACK')
})

test('prefix option: object form', async () => {
	const mw = router.get({'/one': () => setText('1'), '/two': () => setText('2')}, {prefix: '/v1'})
	strictEqual((await call(mw, {path: '/v1/one'})).body, '1')
	strictEqual((await call(mw, {path: '/v1/two'})).body, '2')
	strictEqual((await call(mw, {path: '/two'})).body, 'FALLBACK')
})

test('next() inside a route handler falls through', async () => {
	const mw = router.get('/n', ({next}) => next())
	strictEqual((await call(mw, {path: '/n'})).body, 'FALLBACK')
})

test('verb bindings: head, patch, options, delete each match their method', async () => {
	const head = router.head('/h', () => setText('head-ok'))
	// HEAD strips the body, so assert via status only.
	strictEqual((await call(head, {path: '/h', method: 'HEAD'})).status, 200)
	strictEqual((await call(head, {path: '/h', method: 'GET'})).status, 404)

	const patch = router.patch('/pa', () => setText('patched'))
	strictEqual((await call(patch, {path: '/pa', method: 'PATCH'})).body, 'patched')

	const options = router.options('/o', () => setText('opt'))
	strictEqual((await call(options, {path: '/o', method: 'OPTIONS'})).body, 'opt')

	const del = router.delete('/de', () => setText('deleted'))
	strictEqual((await call(del, {path: '/de', method: 'DELETE'})).body, 'deleted')
})

test('trace verb binding matches its method', async () => {
	const trace = router.trace('/t', () => setText('traced'))
	strictEqual((await call(trace, {path: '/t', method: 'TRACE'})).body, 'traced')
})

// CONNECT cannot be exercised through node's http client (it expects a tunnel and the
// server emits a 'connect' event instead of dispatching to the request handler). Drive
// the connect-bound middleware directly: its routing logic is identical to every other
// verb, differing only by the method string it filters on.
test('connect verb binding filters by the CONNECT method', async () => {
	const connect = router.connect('/c', ({matched}) => matched.pathname.groups)

	// method match: handler runs, next() is not called.
	const onMatch = await runMiddleware(connect, {method: 'CONNECT', path: '/c'})
	strictEqual(onMatch.nextCalled, false)

	// pattern mismatch under a matching method: falls through to next().
	const onPathMiss = await runMiddleware(connect, {method: 'CONNECT', path: '/nope'})
	strictEqual(onPathMiss.nextCalled, true)

	// method mismatch: falls through to next() before any pattern is tested.
	const onMethodMiss = await runMiddleware(connect, {method: 'GET', path: '/c'})
	strictEqual(onMethodMiss.nextCalled, true)
})

test('first matching route wins; later patterns are not reached', async () => {
	const mw = router.get({'/dup': () => setText('first'), '/dup2': () => setText('second')})
	strictEqual((await call(mw, {path: '/dup'})).body, 'first')
	strictEqual((await call(mw, {path: '/dup2'})).body, 'second')
})

test('a GET route also answers HEAD (handler runs, body stripped)', async () => {
	const mw = router.get('/page', () => setText('hello'))

	// GET serves the full body
	const get = await call(mw, {path: '/page', method: 'GET'})
	strictEqual(get.status, 200)
	strictEqual(get.body, 'hello')

	// HEAD is dispatched to the same GET handler (status 200, not the 404 fallback),
	// but writeRes strips the body for HEAD
	const head = await call(mw, {path: '/page', method: 'HEAD'})
	strictEqual(head.status, 200)
	strictEqual(head.body, '')

	// HEAD on an unregistered path still falls through to next()
	strictEqual((await call(mw, {path: '/missing', method: 'HEAD'})).status, 404)

	// HEAD maps to GET only — a non-GET route does not answer HEAD
	const post = router.post('/page', () => setText('posted'))
	strictEqual((await call(post, {path: '/page', method: 'HEAD'})).status, 404)
})

// Drives a router middleware inside a real dxServer context, reporting whether it fell
// through to next(). The request method/url are overridden on the live req object so the
// router observes them, letting us exercise methods (e.g. CONNECT) that node's http client
// cannot send normally. The response is ended here so writeRes never runs.
async function runMiddleware(mw: Chainable, opts: {method: string; path: string}) {
	let nextCalled = false
	const server = new Server((req, res) => {
		req.method = opts.method
		req.url = opts.path
		void dxServer(
			req,
			res,
		)(async () => {
			await mw(() => (nextCalled = true))
			if (!res.writableEnded) res.end()
		}).catch(() => {
			if (!res.writableEnded && !res.destroyed) res.end()
		})
	})
	const port = await new Promise<number>(resolve =>
		server.listen(0, () => resolve((server.address() as AddressInfo).port)),
	)
	try {
		await new Promise<void>((resolve, reject) => {
			const r = request({port, path: '/', method: 'GET'}, res => {
				res.on('data', () => {})
				res.on('end', () => resolve())
				res.on('error', reject)
			})
			r.on('error', reject)
			r.end()
		})
		return {nextCalled}
	} finally {
		server.closeAllConnections?.()
		await new Promise<void>(resolve => server.close(() => resolve()))
	}
}

async function call(mw: Chainable, opts: {method?: string; path?: string} = {}, fallback?: () => any) {
	const server = new Server((req, res) => {
		void dxServer(
			req,
			res,
		)(() => mw(() => (fallback ? fallback() : setText('FALLBACK', {status: 404})))).catch((e: any) => {
			if (!res.writableEnded && !res.destroyed) {
				res.statusCode = e?.statusCode ?? 500
				res.end()
			}
		})
	})
	const port = await new Promise<number>(resolve =>
		server.listen(0, () => resolve((server.address() as AddressInfo).port)),
	)
	try {
		return await new Promise<{status: number; body: string}>((resolve, reject) => {
			const r = request({port, path: opts.path ?? '/', method: opts.method ?? 'GET'}, res => {
				const chunks: Buffer[] = []
				res.on('data', c => chunks.push(c))
				res.on('end', () => resolve({status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString()}))
				res.on('error', reject)
			})
			r.on('error', reject)
			r.end()
		})
	} finally {
		server.closeAllConnections?.()
		await new Promise<void>(resolve => server.close(() => resolve()))
	}
}
