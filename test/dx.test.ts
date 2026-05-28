import {test} from 'node:test'
import {strictEqual, deepEqual, ok, match} from 'node:assert/strict'
import {Server, request} from 'node:http'
import type {AddressInfo} from 'node:net'
import {Readable} from 'node:stream'
import {writeFileSync, mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import dxServer, {
	setText,
	setHtml,
	setJson,
	setBuffer,
	setEmpty,
	setRedirect,
	setNodeStream,
	setWebStream,
	setFile,
	makeDxContext,
	getReq,
} from '../lib/index.js'

test('setText: 200, text/plain, content-length, ETag', async () => {
	const res = await call(() => setText('hi'))
	strictEqual(res.status, 200)
	match(res.headers['content-type'], /text\/plain/)
	strictEqual(res.body.toString(), 'hi')
	strictEqual(res.headers['content-length'], '2')
	ok(res.headers.etag, 'expected an ETag header')
})

test('setText with status 201', async () => {
	const res = await call(() => setText('hi', {status: 201}))
	strictEqual(res.status, 201)
	strictEqual(res.body.toString(), 'hi')
})

test('setHtml: text/html', async () => {
	const res = await call(() => setHtml('<b>x</b>'))
	strictEqual(res.status, 200)
	match(res.headers['content-type'], /text\/html/)
	strictEqual(res.body.toString(), '<b>x</b>')
})

test('setJson: application/json, compact body', async () => {
	const res = await call(() => setJson({a: 1}))
	strictEqual(res.status, 200)
	match(res.headers['content-type'], /application\/json/)
	strictEqual(res.body.toString(), '{"a":1}')
})

test('setJson with jsonBeautify pretty-prints', async () => {
	const res = await call(() => setJson({a: 1}), {serverOptions: {jsonBeautify: true}})
	const body = res.body.toString()
	match(body, /\n/)
	match(body, /\n {2}"a": 1/)
	deepEqual(JSON.parse(body), {a: 1})
})

test('setJson(undefined): empty body', async () => {
	const res = await call(() => setJson(undefined))
	strictEqual(res.status, 200)
	strictEqual(res.body.length, 0)
})

test('setJson with status 201', async () => {
	const res = await call(() => setJson({a: 1}, {status: 201}))
	strictEqual(res.status, 201)
	strictEqual(res.body.toString(), '{"a":1}')
})

test('setBuffer: application/octet-stream', async () => {
	const res = await call(() => setBuffer(Buffer.from('abc')))
	strictEqual(res.status, 200)
	match(res.headers['content-type'], /application\/octet-stream/)
	strictEqual(res.body.toString(), 'abc')
})

test('setBuffer with status 202', async () => {
	const res = await call(() => setBuffer(Buffer.from('abc'), {status: 202}))
	strictEqual(res.status, 202)
	strictEqual(res.body.toString(), 'abc')
})

test('setEmpty: empty body, 200', async () => {
	const res = await call(() => setEmpty())
	strictEqual(res.status, 200)
	strictEqual(res.body.length, 0)
})

test('setEmpty with status 204', async () => {
	const res = await call(() => setEmpty({status: 204}))
	strictEqual(res.status, 204)
	strictEqual(res.body.length, 0)
})

test('204 strips the body and content-length/content-type even when a setter produced them', async () => {
	// setText would normally write 'hello' with a content-type + content-length; a 204 must drop all of it
	const res = await call(() => setText('hello', {status: 204}))
	strictEqual(res.status, 204)
	strictEqual(res.body.length, 0)
	strictEqual(res.headers['content-length'], undefined)
	strictEqual(res.headers['content-type'], undefined)
	strictEqual(res.headers['etag'], undefined)
})

test('explicit 304 carries no body and no content-length', async () => {
	const res = await call(() => setJson({a: 1}, {status: 304}))
	strictEqual(res.status, 304)
	strictEqual(res.body.length, 0)
	strictEqual(res.headers['content-length'], undefined)
	strictEqual(res.headers['content-type'], undefined)
})

test('setRedirect 302: location set, no ETag', async () => {
	// Location must be header-safe: Node rejects non-ASCII chars in header values, so a
	// path like '/там' is sent percent-encoded (encodeURI), matching real redirect usage.
	const target = encodeURI('/там')
	const res = await call(() => setRedirect(target, 302))
	strictEqual(res.status, 302)
	strictEqual(res.headers.location, target)
	strictEqual(res.headers.etag, undefined)
})

test('setRedirect 301', async () => {
	const res = await call(() => setRedirect('/x', 301))
	strictEqual(res.status, 301)
	strictEqual(res.headers.location, '/x')
})

test('setNodeStream: streams body', async () => {
	const res = await call(() => setNodeStream(Readable.from([Buffer.from('foo'), Buffer.from('bar')])))
	strictEqual(res.status, 200)
	strictEqual(res.body.toString(), 'foobar')
})

test('setWebStream: streams body', async () => {
	const res = await call(() =>
		setWebStream(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('web'))
					controller.enqueue(new TextEncoder().encode('stream'))
					controller.close()
				},
			}),
		),
	)
	strictEqual(res.status, 200)
	strictEqual(res.body.toString(), 'webstream')
})

test('setNodeStream with falsy data: empty body', async () => {
	const res = await call(() => setNodeStream(undefined as any))
	strictEqual(res.status, 200)
	strictEqual(res.body.length, 0)
})

test('setWebStream with falsy data: empty body', async () => {
	const res = await call(() => setWebStream(undefined as any))
	strictEqual(res.status, 200)
	strictEqual(res.body.length, 0)
})

test('setFile: serves the file bytes', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-server-test-'))
	const filePath = join(dir, 'payload.txt')
	writeFileSync(filePath, 'file-contents')
	try {
		const res = await call(() => setFile(filePath))
		strictEqual(res.status, 200)
		strictEqual(res.body.toString(), 'file-contents')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('setFile: Content-Type comes from the file extension, not octet-stream', async () => {
	// regression: writeRes must NOT pre-set octet-stream for the 'file' type, or sendFileTrusted's
	// extension-based detection is suppressed and an .html file is served as octet-stream
	const dir = mkdtempSync(join(tmpdir(), 'dx-server-test-'))
	try {
		const html = join(dir, 'index.html')
		writeFileSync(html, '<h1>hi</h1>')
		const htmlRes = await call(() => setFile(html))
		match(htmlRes.headers['content-type'], /^text\/html/)

		// a no-extension file still falls back to octet-stream (sendFileTrusted's own default)
		const bin = join(dir, 'blob')
		writeFileSync(bin, 'data')
		const binRes = await call(() => setFile(bin))
		strictEqual(binRes.headers['content-type'], 'application/octet-stream')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('no setter called: 404', async () => {
	const res = await call(() => {})
	strictEqual(res.status, 404)
})

test('common option charset: drives the body encoding and the content-type label', async () => {
	// 'café' encoded as latin1 is 4 bytes (é -> 0xe9); utf-8 would be 5 bytes
	const res = await call(() => setText('café', {charset: 'latin1'}))
	strictEqual(res.headers['content-type'], 'text/plain; charset=latin1')
	deepEqual([...res.body], [0x63, 0x61, 0x66, 0xe9])
})

test('common option disableEtag: suppresses the ETag per setter', async () => {
	strictEqual((await call(() => setText('hi', {disableEtag: true}))).headers.etag, undefined)
	strictEqual((await call(() => setJson({a: 1}, {disableEtag: true}))).headers.etag, undefined)
	strictEqual((await call(() => setBuffer(Buffer.from('x'), {disableEtag: true}))).headers.etag, undefined)
	// without the option an ETag is still emitted
	ok((await call(() => setText('hi'))).headers.etag, 'expected an ETag when disableEtag is not set')
})

test('common options coexist with status', async () => {
	const res = await call(() => setJson({ok: 1}, {status: 201, disableEtag: true}))
	strictEqual(res.status, 201)
	strictEqual(res.headers.etag, undefined)
	deepEqual(JSON.parse(res.body.toString()), {ok: 1})
})

test('ETag / 304: if-none-match returns 304 with empty body', async () => {
	const first = await call(() => setText('cacheable'))
	const etag = first.headers.etag
	ok(etag, 'expected an ETag on the first response')

	const second = await call(() => setText('cacheable'), {headers: {'if-none-match': etag}})
	strictEqual(second.status, 304)
	strictEqual(second.body.length, 0)
	// the freshETag -> 304 transition keeps the ETag (it's a validator) but drops the body framing
	strictEqual(second.headers.etag, etag)
	strictEqual(second.headers['content-length'], undefined)
	strictEqual(second.headers['content-type'], undefined)
})

test('disableEtag: no ETag header', async () => {
	const res = await call(() => setText('hi'), {serverOptions: {disableEtag: true}})
	strictEqual(res.status, 200)
	strictEqual(res.headers.etag, undefined)
})

test('HEAD request: empty body', async () => {
	const res = await call(() => setText('body-here'), {method: 'HEAD'})
	strictEqual(res.status, 200)
	strictEqual(res.body.length, 0)
})

test('makeDxContext: memoizes once per request, value getter', async () => {
	const ctx = makeDxContext(async (x: number) => x + 1)
	const res = await call(async () => {
		const v = await ctx(2)
		strictEqual(v, 3)
		const again = await ctx(99)
		strictEqual(again, 3)
		strictEqual(ctx.value, 3)
		setText('ok')
	})
	strictEqual(res.status, 200)
})

test('makeDxContext: value setter overrides memoization', async () => {
	const ctx = makeDxContext(async (x: number) => x + 1)
	const res = await call(async () => {
		ctx.value = 10
		const v = await ctx(2)
		strictEqual(v, 10)
		strictEqual(ctx.value, 10)
		setText('ok')
	})
	strictEqual(res.status, 200)
})

test('makeDxContext: set/get by req', async () => {
	const ctx = makeDxContext(async (x: number) => x + 1)
	const res = await call(async () => {
		ctx.set(getReq(), 7)
		strictEqual(ctx.get(getReq()), 7)
		strictEqual(await ctx(123), 7)
		setText('ok')
	})
	strictEqual(res.status, 200)
})

test('makeDxContext: each request recomputes once (no cross-request sharing)', async () => {
	let calls = 0
	const ctx = makeDxContext(async () => {
		calls++
		return calls
	})
	const handler = async () => {
		const a = await ctx()
		const b = await ctx()
		strictEqual(a, b, 'maker must run once per request')
		setJson({value: a})
	}

	const first = await call(handler)
	const second = await call(handler)
	strictEqual(calls, 2, 'maker should run exactly once per request')
	deepEqual(JSON.parse(first.body.toString()), {value: 1})
	deepEqual(JSON.parse(second.body.toString()), {value: 2})
})

test('makeDxContext: chain runs maker then next', async () => {
	const ctx = makeDxContext(async (x: number) => x + 1)
	const res = await call(async () => {
		let nextRan = false
		const out = await ctx.chain(5)(() => {
			nextRan = true
			return 'next-result'
		})
		ok(nextRan, 'next callback should have run')
		strictEqual(out, 'next-result')
		strictEqual(ctx.value, 6)
		setText('ok')
	})
	strictEqual(res.status, 200)
})

test('writeRes: chain resolves (no double res.end); HEAD mirrors GET content-length/ETag', async () => {
	// regression: writeRes called res.end() twice, so the chain rejected with
	// ERR_STREAM_ALREADY_FINISHED on every non-HEAD response (body still flushed, but unguarded
	// chains saw an unhandled rejection). HEAD also gained the Content-Length/ETag a GET sends.
	const errors: any[] = []
	const server = new Server((req, res) => {
		dxServer(req, res)(async () => setText('payload')).catch((e: any) => errors.push(e))
	})
	const port = await new Promise<number>(resolve =>
		server.listen(0, () => resolve((server.address() as AddressInfo).port)),
	)
	try {
		const get = await fetchInfo('GET')
		strictEqual(get.status, 200)
		strictEqual(get.body, 'payload')
		ok(get.headers['content-length'], 'GET has content-length')
		ok(get.headers.etag, 'GET has etag')

		const head = await fetchInfo('HEAD')
		strictEqual(head.status, 200)
		strictEqual(head.body, '')
		strictEqual(head.headers['content-length'], String(Buffer.byteLength('payload')))
		ok(head.headers.etag, 'HEAD mirrors the GET etag')
	} finally {
		server.closeAllConnections?.()
		await new Promise<void>(resolve => server.close(() => resolve()))
	}
	await new Promise<void>(resolve => setImmediate(resolve))
	strictEqual(errors.length, 0, `chain must not reject (got: ${errors.map(e => e?.code ?? e?.message).join(', ')})`)

	function fetchInfo(method: string) {
		return new Promise<{status: number; headers: Record<string, any>; body: string}>((resolve, reject) => {
			const r = request({port, path: '/', method}, res => {
				const chunks: Buffer[] = []
				res.on('data', c => chunks.push(c))
				res.on('end', () =>
					resolve({status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString()}),
				)
				res.on('error', reject)
			})
			r.on('error', reject)
			r.end()
		})
	}
})

async function call(
	handler: () => any,
	opts: {method?: string; path?: string; headers?: Record<string, string>; serverOptions?: any} = {},
) {
	const server = new Server((req, res) => {
		dxServer(
			req,
			res,
			opts.serverOptions,
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
		return await new Promise<{status: number; headers: Record<string, any>; body: Buffer}>((resolve, reject) => {
			const r = request(
				{port, path: opts.path ?? '/', method: opts.method ?? 'GET', headers: opts.headers ?? {}},
				res => {
					const chunks: Buffer[] = []
					res.on('data', c => chunks.push(c))
					res.on('end', () => resolve({status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks)}))
					res.on('error', reject)
				},
			)
			r.on('error', reject)
			r.end()
		})
	} finally {
		server.closeAllConnections?.()
		await new Promise<void>(resolve => server.close(() => resolve()))
	}
}
