import {test} from 'node:test'
import {ok, strictEqual} from 'node:assert/strict'
import {Server, request} from 'node:http'
import type {AddressInfo} from 'node:net'
import {writeFileSync, mkdtempSync, rmSync, symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import dxServer, {setFile, setRedirect, setJson, getJson, chainStatic} from '../lib/index.js'

// H5: parseRange caps the number of ranges (default 100) -> 416 above the cap
test('H5: a Range header with too many ranges is rejected with 416', async t => {
	t.mock.method(console, 'error', () => {}) // the global catch logs the [dx-server] 416
	const dir = mkdtempSync(join(tmpdir(), 'dx-sec-'))
	const file = join(dir, 'data.txt')
	writeFileSync(file, 'HELLO-WORLD-0123456789')
	try {
		const many = 'bytes=' + Array.from({length: 200}, (_, i) => `${i}-${i}`).join(',')
		strictEqual(await status(() => setFile(file), {range: many}), 416)
		strictEqual(await status(() => setFile(file), {range: 'bytes=0-4'}), 206)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

// M4: If-Range must match the ETag exactly, not as a substring
test('M4: If-Range that merely contains the ETag does not trigger a 206', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-sec-'))
	const file = join(dir, 'data.txt')
	writeFileSync(file, 'HELLO-WORLD-0123456789')
	try {
		const etag = await header(() => setFile(file), {}, 'etag')
		ok(etag, 'expected an ETag')
		strictEqual(await status(() => setFile(file), {range: 'bytes=0-4', 'if-range': etag!}), 206)
		// superstring of the real ETag must NOT be treated as fresh -> full 200, not 206
		strictEqual(await status(() => setFile(file), {range: 'bytes=0-4', 'if-range': etag + 'X'}), 200)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

// M3: redirects must not carry an ETag (else a cached If-None-Match could 304 them)
test('M3: setRedirect emits no ETag and is never 304', async () => {
	strictEqual(await header(() => setRedirect('/elsewhere', 302), {}, 'etag'), undefined)
	const emptyBodyEtag = '"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"'
	strictEqual(await status(() => setRedirect('/elsewhere', 302), {'if-none-match': emptyBodyEtag}), 302)
})

// M8: charset gate is a positive allowlist (utf-7 must be rejected)
test('M8: a utf-7 charset is rejected', async () => {
	const post = {method: 'POST', 'content-type': 'application/json; charset=utf-7', body: '{"a":1}'}
	strictEqual(await status(async () => setJson(await getJson()), post), 500)
	strictEqual(
		await status(async () => setJson(await getJson()), {...post, 'content-type': 'application/json; charset=utf-8'}),
		200,
	)
})

// H2: with disableFollowSymlinks a symlink whose target escapes root is forbidden
test('H2: disableFollowSymlinks blocks a symlink that escapes root', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-sec-'))
	const outside = join(dir, 'outside.txt')
	writeFileSync(outside, 'SECRET-OUTSIDE')
	const root = mkdtempSync(join(tmpdir(), 'dx-root-'))
	symlinkSync(outside, join(root, 'link.txt'))
	writeFileSync(join(root, 'real.txt'), 'REAL-IN-ROOT')
	try {
		strictEqual(await staticStatus({root, disableFollowSymlinks: true}, '/link.txt'), 403)
		strictEqual(await staticStatus({root, disableFollowSymlinks: true}, '/real.txt'), 200)
		strictEqual(await staticStatus({root, disableFollowSymlinks: false}, '/link.txt'), 200)
	} finally {
		rmSync(dir, {recursive: true, force: true})
		rmSync(root, {recursive: true, force: true})
	}
})

// ---- harness ----

type Opts = {
	method?: string
	body?: string
	range?: string
	'if-range'?: string
	'if-none-match'?: string
	'content-type'?: string
}

function setterServer(fn: () => unknown) {
	return new Server((req, res) => {
		dxServer(
			req,
			res,
		)(async () => fn()).catch((e: any) => {
			if (!res.writableEnded && !res.destroyed) {
				res.statusCode = e?.statusCode ?? 500
				res.end()
			}
		})
	})
}

function staticServer(options: any) {
	return new Server((req, res) => {
		dxServer(
			req,
			res,
		)(() =>
			chainStatic(
				'/*',
				options,
			)((e: any) => {
				if (!res.writableEnded && !res.destroyed) {
					res.statusCode = e?.statusCode ?? 404
					res.end()
				}
			}),
		).catch((e: any) => {
			if (!res.writableEnded && !res.destroyed) {
				res.statusCode = e?.statusCode ?? 500
				res.end()
			}
		})
	})
}

async function fetchOnce(server: Server, path: string, opts: Opts) {
	const port = await listen(server)
	try {
		const headers: Record<string, string> = {}
		if (opts.range) headers.range = opts.range
		if (opts['if-range']) headers['if-range'] = opts['if-range']
		if (opts['if-none-match']) headers['if-none-match'] = opts['if-none-match']
		if (opts['content-type']) headers['content-type'] = opts['content-type']
		return await new Promise<{status: number; headers: Record<string, any>}>((resolve, reject) => {
			const r = request({port, path, method: opts.method ?? 'GET', headers}, res => {
				res.resume()
				res.on('end', () => resolve({status: res.statusCode ?? 0, headers: res.headers}))
				res.on('error', reject)
			})
			r.on('error', reject)
			if (opts.body) r.write(opts.body)
			r.end()
		})
	} finally {
		await closeServer(server)
	}
}

async function status(fn: () => unknown, opts: Opts) {
	return (await fetchOnce(setterServer(fn), '/', opts)).status
}
async function header(fn: () => unknown, opts: Opts, name: string) {
	return (await fetchOnce(setterServer(fn), '/', opts)).headers[name] as string | undefined
}
async function staticStatus(options: any, path: string) {
	return (await fetchOnce(staticServer(options), path, {})).status
}

function listen(server: Server) {
	return new Promise<number>(resolve => server.listen(0, () => resolve((server.address() as AddressInfo).port)))
}
async function closeServer(server: Server) {
	server.closeAllConnections?.()
	await new Promise<void>(resolve => server.close(() => resolve()))
}
