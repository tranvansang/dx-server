import {test} from 'node:test'
import {strictEqual, deepEqual, ok, match} from 'node:assert/strict'
import {Server, request} from 'node:http'
import type {AddressInfo} from 'node:net'
import {Readable} from 'node:stream'
import {writeFileSync, mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {writeRes} from '../lib/dxHelpers.js'
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
	getRes,
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

test('setJson: application/json (no charset label), compact body', async () => {
	const res = await call(() => setJson({a: 1}))
	strictEqual(res.status, 200)
	// JSON is always UTF-8 with no charset parameter (RFC 8259)
	strictEqual(res.headers['content-type'], 'application/json')
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

test('setNodeStream / setWebStream accept a status', async () => {
	const node = await call(() => setNodeStream(Readable.from(['x']), {status: 207}))
	strictEqual(node.status, 207)
	strictEqual(node.body.toString(), 'x')

	const web = await call(() =>
		setWebStream(
			new ReadableStream({
				start(c) {
					c.enqueue(new Uint8Array([121]))
					c.close()
				},
			}),
			{status: 207},
		),
	)
	strictEqual(web.status, 207)
	strictEqual(web.body.toString(), 'y')
})

test('a content-type set by the handler is preserved (setters do not override it)', async () => {
	// setContentType bails out when a content-type is already present, so a setter never clobbers a
	// type a prior middleware/handler chose — this is how a non-default charset is applied.
	const res = await call(() => {
		getRes().setHeader('content-type', 'text/plain; charset=latin1')
		setText('hi')
	})
	strictEqual(res.status, 200)
	strictEqual(res.headers['content-type'], 'text/plain; charset=latin1')
	strictEqual(res.body.toString(), 'hi')
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

test('status applies on setHtml and setFile', async () => {
	strictEqual((await call(() => setHtml('<b>x</b>', {status: 201}))).status, 201)
	const dir = mkdtempSync(join(tmpdir(), 'dx-server-test-'))
	try {
		const f = join(dir, 'f.txt')
		writeFileSync(f, 'data')
		strictEqual((await call(() => setFile(f, {status: 206}))).status, 206)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('disableEtag suppresses the ETag on the buffer-backed setters', async () => {
	strictEqual((await call(() => setText('hi', {disableEtag: true}))).headers.etag, undefined)
	strictEqual((await call(() => setHtml('<b>x</b>', {disableEtag: true}))).headers.etag, undefined)
	strictEqual((await call(() => setBuffer(Buffer.from('x'), {disableEtag: true}))).headers.etag, undefined)
	strictEqual((await call(() => setJson({a: 1}, {disableEtag: true}))).headers.etag, undefined)
	strictEqual((await call(() => setEmpty({disableEtag: true}))).headers.etag, undefined)
	// without the option these types are ETagged by default
	ok((await call(() => setText('hi'))).headers.etag, 'text is ETagged by default')
	ok((await call(() => setEmpty())).headers.etag, 'empty responses are ETagged by default')
})

test('streams and redirects are never ETagged (so they take no disableEtag option)', async () => {
	strictEqual((await call(() => setNodeStream(Readable.from(['x'])))).headers.etag, undefined)
	const web = () =>
		setWebStream(
			new ReadableStream({
				start(c) {
					c.enqueue(new Uint8Array([120]))
					c.close()
				},
			}),
		)
	strictEqual((await call(web)).headers.etag, undefined)
	strictEqual((await call(() => setRedirect('/elsewhere', 302))).headers.etag, undefined)
})

test('setFile ETag is controlled by SendFileOptions.etag, not a disableEtag option', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-server-test-'))
	try {
		const f = join(dir, 'f.txt')
		writeFileSync(f, 'data')
		ok((await call(() => setFile(f))).headers.etag, 'setFile emits a weak ETag by default')
		strictEqual((await call(() => setFile(f, {etag: 'disabled'}))).headers.etag, undefined)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
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

test('writeRes: a body too big to flush synchronously resolves only after finish (awaitResFinished listener path)', async () => {
	// a small body flushes inside res.end() (writableFinished is already true, so awaitResFinished
	// early-returns). A multi-MiB body under a paused reader cannot flush synchronously, so
	// writableFinished is false when awaitResFinished runs — exercising its finish-listener path.
	const big = Buffer.alloc(4 * 1024 * 1024, 0x61) // 4 MiB of 'a'
	let resolveChain: (finished: boolean) => void
	const chainDone = new Promise<boolean>(resolve => (resolveChain = resolve))
	const server = new Server((req, res) => {
		void dxServer(req, res)(async () => setBuffer(big, {disableEtag: true})).then(() =>
			// when the chain resolves, the bytes are flushed — writableFinished proves it wasn't the
			// early-return shortcut but the finish-listener path that completed it
			resolveChain(res.writableFinished),
		)
	})
	const port = await new Promise<number>(resolve =>
		server.listen(0, () => resolve((server.address() as AddressInfo).port)),
	)
	try {
		const body = await new Promise<Buffer>((resolve, reject) => {
			const r = request({port, path: '/', method: 'GET'}, res => {
				const chunks: Buffer[] = []
				res.pause() // hold back the reader so the server hits backpressure on res.end()
				setTimeout(() => {
					res.on('data', c => chunks.push(c))
					res.on('end', () => resolve(Buffer.concat(chunks)))
					res.resume()
				}, 50)
				res.on('error', reject)
			})
			r.on('error', reject)
			r.end()
		})
		strictEqual(body.length, big.length)
		ok(await chainDone, 'chain resolves only after the response is fully flushed (writableFinished)')
	} finally {
		server.closeAllConnections?.()
		await new Promise<void>(resolve => server.close(() => resolve()))
	}
})

test('writeRes: unknown response type logs the error and finishes with 500 (defensive default arm)', async t => {
	// the discriminated union makes this unreachable through the public setters, so drive writeRes
	// directly with a bogus type to exercise the `type satisfies never` backstop.
	const errors: unknown[][] = []
	t.mock.method(console, 'error', (...args: unknown[]) => void errors.push(args))

	const server = new Server((req, res) => {
		void writeRes(req, res, {type: 'bogus', data: undefined, options: undefined} as any)
	})
	const port = await new Promise<number>(resolve =>
		server.listen(0, () => resolve((server.address() as AddressInfo).port)),
	)
	try {
		const status = await new Promise<number>(resolve => {
			const r = request({port, path: '/', method: 'GET'}, res => {
				const s = res.statusCode ?? 0 // status is known once headers arrive
				res.on('data', () => {})
				// fail() destroys the socket after responding, so resolve on any terminal event
				res.on('end', () => resolve(s))
				res.on('close', () => resolve(s))
				res.on('error', () => resolve(s))
			})
			r.on('error', () => resolve(0))
			r.end()
		})
		strictEqual(status, 500)
	} finally {
		server.closeAllConnections?.()
		await new Promise<void>(resolve => server.close(() => resolve()))
	}
	strictEqual(errors.length, 1)
	strictEqual(errors[0][0], '[dx-server]')
	match(String((errors[0][1] as Error)?.message), /unsupported response type bogus/)
})

// --- writeRes never throws: reproduce every throwing statement ----------------------------------
// dxServer must settle its chain even when a setter feeds writeRes a value that makes an internal
// statement throw. Each test reproduces one such throw; with the never-throw guard in place the
// chain resolves, and without it (e.g. the guard git-stashed) the chain rejects and the test fails —
// which is how we know the guard, not the harness, holds the guarantee. dxChain mirrors the
// documented usage exactly: dxServer at the top of the 'request' listener with NO try/catch.

test('dxServer chain settles on an unserializable JSON body (circular reference)', async t => {
	t.mock.method(console, 'error', () => {}) // silence the expected [dx-server] log
	const circular: any = {}
	circular.self = circular // JSON.stringify throws "Converting circular structure to JSON"
	await dxChain(() => setJson(circular))
})

test('dxServer chain settles on an unserializable JSON body (BigInt)', async t => {
	t.mock.method(console, 'error', () => {})
	// JSON.stringify throws "Do not know how to serialize a BigInt"
	await dxChain(() => setJson({amount: 1n}))
})

test('dxServer chain settles on a header-invalid redirect URL', async t => {
	t.mock.method(console, 'error', () => {})
	// a newline in the Location value makes res.setHeader throw ERR_INVALID_CHAR
	await dxChain(() => setRedirect('/\n/evil', 302))
})

test('dxServer chain settles on a non-string text body (Buffer.from throws)', async t => {
	t.mock.method(console, 'error', () => {})
	// a value that slipped past the types: Buffer.from(123) throws ERR_INVALID_ARG_TYPE
	await dxChain(() => setText(123 as any))
})

test('writeRes settles when res.end() throws synchronously (torn-down socket)', async t => {
	t.mock.method(console, 'error', () => {})
	// res.write/res.end throw synchronously on a destroyed socket; reproduce with a res whose end()
	// throws — on both the buffered flush path and the endRes (no-setter -> 404) path.
	const req = {method: 'GET', headers: {}} as any

	await writeRes(req, makeRes() as any, {type: 'text', data: 'hi', options: undefined} as any)
	await writeRes(req, makeRes() as any, {type: undefined, data: undefined, options: undefined} as any)

	// a res whose end() throws, on both the buffered flush path and the endRes path
	function makeRes() {
		return {
			headersSent: false,
			writableEnded: false,
			writableFinished: true, // so awaitResFinished resolves without waiting on events
			destroyed: false,
			statusCode: 200,
			_headers: {} as Record<string, unknown>,
			setHeader(k: string, v: unknown) {
				this._headers[k.toLowerCase()] = v
			},
			getHeader(k: string) {
				return this._headers[k.toLowerCase()]
			},
			getHeaderNames() {
				return Object.keys(this._headers)
			},
			removeHeader(k: string) {
				delete this._headers[k.toLowerCase()]
			},
			write() {
				return true
			},
			end() {
				throw new Error('socket gone')
			},
			destroy() {
				this.destroyed = true
			},
		}
	}
})

test('an internal failure answers with a generic 500 page and destroys the socket (express-style)', async t => {
	t.mock.method(console, 'error', () => {}) // silence the expected [dx-server] log
	const circular: any = {}
	circular.self = circular

	const {status, headers, body, res} = await failResponse(() => setJson(circular))
	strictEqual(status, 500)
	strictEqual(headers['content-type'], 'text/html')
	// the error is never leaked to the client — always the generic message (production behavior)
	strictEqual(body, 'Internal Server Error')
	strictEqual(res.destroyed, true, 'the socket is torn down after an internal error')
})

test('internal-failure 500: a HEAD request reports the status but carries no body', async t => {
	t.mock.method(console, 'error', () => {})
	const circular: any = {}
	circular.self = circular
	const {status, body} = await failResponse(() => setJson(circular), {method: 'HEAD'})
	strictEqual(status, 500)
	strictEqual(body, '', 'HEAD has no body')
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

// Runs a handler exactly as the docs recommend — dxServer at the top of the 'request' listener with
// NO try/catch — then awaits the chain so the test fails if it rejected. The catch().finally() ends
// a response the chain left open (the unprotected build rejects before flushing) so the HTTP client
// doesn't hang; it never masks the rejection, which is re-observed by the final `await chain`.
async function dxChain(
	handler: () => any,
	opts: {method?: string; path?: string; headers?: Record<string, string>} = {},
) {
	let chain!: Promise<unknown>
	const server = new Server((req, res) => {
		chain = dxServer(req, res)(async () => handler())
		void chain.catch(() => {}).finally(() => {
			if (!res.writableEnded && !res.destroyed) res.end()
		})
	})
	const port = await new Promise<number>(resolve =>
		server.listen(0, () => resolve((server.address() as AddressInfo).port)),
	)
	try {
		await new Promise<void>(resolve => {
			const r = request({port, path: opts.path ?? '/', method: opts.method ?? 'GET', headers: opts.headers ?? {}}, res => {
				res.on('data', () => {})
				// fail() may destroy the socket after responding; we only need the handler to have run,
				// so resolve on any terminal event rather than rejecting on the teardown
				res.on('end', () => resolve())
				res.on('close', () => resolve())
				res.on('error', () => resolve())
			})
			r.on('error', () => resolve())
			r.end()
		})
	} finally {
		server.closeAllConnections?.()
		await new Promise<void>(resolve => server.close(() => resolve()))
	}
	await chain // reproduces the raw throw: rejects against the unprotected build
}

// Drives a handler whose writeRes fails, and returns the response plus the (now torn-down) res.
// Tolerates the socket teardown fail() performs after responding.
async function failResponse(handler: () => any, opts: {method?: string} = {}) {
	let res!: any
	let chain!: Promise<unknown>
	const server = new Server((rq, rs) => {
		res = rs
		chain = dxServer(rq, rs)(async () => handler())
		void chain.catch(() => {})
	})
	const port = await new Promise<number>(resolve =>
		server.listen(0, () => resolve((server.address() as AddressInfo).port)),
	)
	let status = 0
	let headers: Record<string, any> = {}
	const chunks: Buffer[] = []
	await new Promise<void>(resolve => {
		const r = request({port, path: '/', method: opts.method ?? 'GET'}, rs => {
			status = rs.statusCode ?? 0
			headers = rs.headers
			rs.on('data', c => chunks.push(c))
			rs.on('end', () => resolve())
			rs.on('close', () => resolve())
			rs.on('error', () => resolve())
		})
		r.on('error', () => resolve())
		r.end()
	})
	await chain
	server.closeAllConnections?.()
	await new Promise<void>(resolve => server.close(() => resolve()))
	return {status, headers, body: Buffer.concat(chunks).toString(), res}
}
