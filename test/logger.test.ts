import {test} from 'node:test'
import {ok, strictEqual, deepEqual, match} from 'node:assert/strict'
import {Server, request} from 'node:http'
import type {AddressInfo} from 'node:net'
import dxServer, {logger, logJson, setText} from '../lib/index.js'

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/

test('custom log fn captures request and finish entries', async () => {
	const entries: any[] = []
	const log = (e: any) => entries.push(e)

	await call(logger(log))
	await tick()

	ok(entries.length >= 2, `expected at least 2 entries, got ${entries.length}`)

	const first = entries[0]
	strictEqual(first.method, 'GET')
	strictEqual(first.url, '/test?q=1')
	match(first.httpVersion, /^HTTP\//)
	strictEqual(typeof first.timestamp, 'string')
	match(first.timestamp, TIMESTAMP_RE)
	strictEqual(typeof first.id, 'number')
	strictEqual(first.level, 'info')

	const last = entries[entries.length - 1]
	strictEqual(typeof last.duration, 'number')
	strictEqual(typeof last.headers, 'object')
	ok(last.headers !== null, 'finish entry headers must be an object')
	strictEqual(last.id, first.id, 'request and finish entries must share the same id')
})

test('timezoneOffset still produces a valid timestamp format', async () => {
	const entries: any[] = []
	const log = (e: any) => entries.push(e)

	await call(logger(log, {timezoneOffset: 9}))
	await tick()

	ok(entries.length >= 1)
	match(entries[0].timestamp, TIMESTAMP_RE)
})

test('non-production headers are filtered to the allowlist', async () => {
	const entries: any[] = []
	const log = (e: any) => entries.push(e)

	const saved = process.env.NODE_ENV
	delete process.env.NODE_ENV
	try {
		await call(logger(log), {
			headers: {host: 'example.test', 'user-agent': 'dx-test', 'x-custom': 'secret'},
		})
		await tick()
	} finally {
		restoreEnv(saved)
	}

	const headers = entries[0].headers
	strictEqual(headers['user-agent'], 'dx-test')
	ok('host' in headers, 'allowlisted host header should be present')
	ok(!('x-custom' in headers), 'non-allowlisted x-custom header must be filtered out')
})

test('production headers include all request headers', async () => {
	const entries: any[] = []
	const log = (e: any) => entries.push(e)

	const saved = process.env.NODE_ENV
	process.env.NODE_ENV = 'production'
	try {
		await call(logger(log), {
			headers: {host: 'example.test', 'user-agent': 'dx-test', 'x-custom': 'secret'},
		})
		await tick()
	} finally {
		restoreEnv(saved)
	}

	const headers = entries[0].headers
	strictEqual(headers['x-custom'], 'secret', 'production mode must log all headers')
	strictEqual(headers['user-agent'], 'dx-test')
})

test('logJson stringifies and writes to console.log', () => {
	const saved = console.log
	const captured: any[] = []
	console.log = (...args: any[]) => captured.push(args)
	try {
		logJson({a: 1})
	} finally {
		console.log = saved
	}

	strictEqual(captured.length, 1)
	deepEqual(captured[0], ['{"a":1}'])
})

test('default log arg uses logJson via console.log', async () => {
	const saved = console.log
	const captured: string[] = []
	console.log = (...args: any[]) => captured.push(String(args[0]))
	try {
		await call(logger())
		await tick()
	} finally {
		console.log = saved
	}

	ok(captured.length >= 1, 'console.log should be called at least once')
	const parsed = JSON.parse(captured[0])
	strictEqual(typeof parsed.id, 'number')
})

function restoreEnv(saved: string | undefined) {
	if (saved === undefined) delete process.env.NODE_ENV
	else process.env.NODE_ENV = saved
}

function tick() {
	return new Promise<void>(resolve => setImmediate(resolve))
}

async function call(mw: (next: () => any) => any, opts: {headers?: Record<string, string>} = {}) {
	const server = new Server((req, res) => {
		void dxServer(req, res)(() => mw(() => setText('ok'))).catch((e: any) => {
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
			const r = request({port, path: '/test?q=1', method: 'GET', headers: opts.headers ?? {}}, res => {
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
