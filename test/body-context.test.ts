import {test} from 'node:test'
import {strictEqual, deepEqual, ok} from 'node:assert/strict'
import {Server, request} from 'node:http'
import type {AddressInfo} from 'node:net'
import dxServer, {getBuffer, getJson, getRaw, getText, getUrlEncoded, getQuery, setJson, setText} from '../lib/index.js'

// Exercises the public body-context getters (body.ts wrappers) end-to-end through a real
// request, so each makeDxContext maker actually runs inside the dxServer AsyncLocalStorage scope.

test('getJson: parses a posted JSON body', async () => {
	const res = await call(async () => setJson(await getJson()), {
		method: 'POST',
		headers: {'content-type': 'application/json'},
		body: '{"a":1,"b":"two"}',
	})
	deepEqual(JSON.parse(res.body), {a: 1, b: 'two'})
})

test('getText: returns a posted text body', async () => {
	const res = await call(async () => setText((await getText()) ?? ''), {
		method: 'POST',
		headers: {'content-type': 'text/plain'},
		body: 'hello text',
	})
	strictEqual(res.body, 'hello text')
})

test('getRaw: returns a posted octet-stream body', async () => {
	const res = await call(async () => setJson({len: (await getRaw())?.length ?? -1}), {
		method: 'POST',
		headers: {'content-type': 'application/octet-stream'},
		body: 'abcd',
	})
	deepEqual(JSON.parse(res.body), {len: 4})
})

test('getBuffer: returns the raw buffer regardless of content-type', async () => {
	const res = await call(async () => setJson({len: (await getBuffer())?.length ?? -1}), {
		method: 'POST',
		headers: {'content-type': 'application/x-custom'},
		body: 'abcdef',
	})
	deepEqual(JSON.parse(res.body), {len: 6})
})

test('getUrlEncoded: parses a posted form body', async () => {
	const res = await call(async () => setJson((await getUrlEncoded()) ?? {}), {
		method: 'POST',
		headers: {'content-type': 'application/x-www-form-urlencoded'},
		body: 'a=1&b=2',
	})
	deepEqual(JSON.parse(res.body), {a: '1', b: '2'})
})

test('getQuery: parses the query string', async () => {
	const res = await call(async () => setJson(await getQuery()), {path: '/p?a=1&b=2'})
	deepEqual(JSON.parse(res.body), {a: '1', b: '2'})
})

test('getJson is memoized per request and exposes .value', async () => {
	const res = await call(
		async () => {
			const first = await getJson()
			const second = await getJson()
			setJson({same: first === second, value: getJson.value})
		},
		{
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: '{"x":9}',
		},
	)
	deepEqual(JSON.parse(res.body), {same: true, value: {x: 9}})
})

test('getJson.chain runs the maker then the next handler', async () => {
	const res = await call(() => getJson.chain()(() => setJson({chained: getJson.value})), {
		method: 'POST',
		headers: {'content-type': 'application/json'},
		body: '{"y":7}',
	})
	deepEqual(JSON.parse(res.body), {chained: {y: 7}})
})

async function call(
	handler: () => unknown,
	opts: {method?: string; path?: string; headers?: Record<string, string>; body?: string} = {},
) {
	const server = new Server((req, res) => {
		dxServer(
			req,
			res,
		)(async () => handler()).catch((e: any) => {
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
			const r = request(
				{port, path: opts.path ?? '/', method: opts.method ?? 'GET', headers: opts.headers ?? {}},
				res => {
					const chunks: Buffer[] = []
					res.on('data', c => chunks.push(c))
					res.on('end', () => resolve({status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString()}))
					res.on('error', reject)
				},
			)
			r.on('error', reject)
			if (opts.body !== undefined) r.write(opts.body)
			r.end()
		})
	} finally {
		server.closeAllConnections?.()
		await new Promise<void>(resolve => server.close(() => resolve()))
	}
}
