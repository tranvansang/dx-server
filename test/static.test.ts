import {test} from 'node:test'
import {strictEqual, ok, match} from 'node:assert/strict'
import {Server, request} from 'node:http'
import type {AddressInfo} from 'node:net'
import {mkdtempSync, writeFileSync, rmSync, symlinkSync, chmodSync, mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import dxServer, {chainStatic} from '../lib/index.js'
import type {SendFileOptions} from '../lib/staticHelpers.js'

type Options = SendFileOptions & {getPathname?(matched: any): string}
type FetchOpts = {method?: string; path?: string; headers?: Record<string, string>; pattern?: string}
type Result = {status: number; headers: Record<string, any>; body: Buffer}

const isRoot = process.getuid?.() === 0

test('basic serve: 200 with body and standard headers', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'hello.txt'), 'HELLO WORLD')
		const r = await fetchStatic({root: dir}, {path: '/hello.txt'})
		strictEqual(r.status, 200)
		strictEqual(r.body.toString(), 'HELLO WORLD')
		match(r.headers['content-type'], /text\/plain/)
		strictEqual(r.headers['content-length'], '11')
		strictEqual(r.headers['accept-ranges'], 'bytes')
		match(r.headers['cache-control'], /public, max-age=\d+/)
		ok(r.headers['last-modified'], 'last-modified present')
		ok(r.headers['etag'], 'etag present')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('content-type by extension', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'data.json'), '{"a":1}')
		writeFileSync(join(dir, 'page.html'), '<h1>x</h1>')
		writeFileSync(join(dir, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
		writeFileSync(join(dir, 'noext'), 'binary')

		match((await fetchStatic({root: dir}, {path: '/data.json'})).headers['content-type'], /application\/json/)
		match((await fetchStatic({root: dir}, {path: '/page.html'})).headers['content-type'], /text\/html/)
		match((await fetchStatic({root: dir}, {path: '/img.png'})).headers['content-type'], /image\/png/)
		strictEqual((await fetchStatic({root: dir}, {path: '/noext'})).headers['content-type'], 'application/octet-stream')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('charset option overrides the Content-Type charset', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'page.html'), '<h1>x</h1>')
		writeFileSync(join(dir, 'noext'), 'binary')

		// default: text/* carries charset=utf-8
		strictEqual(
			(await fetchStatic({root: dir}, {path: '/page.html'})).headers['content-type'],
			'text/html; charset=utf-8',
		)
		// explicit charset replaces the default utf-8
		strictEqual(
			(await fetchStatic({root: dir, charset: 'latin1'}, {path: '/page.html'})).headers['content-type'],
			'text/html; charset=latin1',
		)
		// charset is appended even to a type that normally has none
		strictEqual(
			(await fetchStatic({root: dir, charset: 'utf-8'}, {path: '/noext'})).headers['content-type'],
			'application/octet-stream; charset=utf-8',
		)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('etag modes', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'content here')

		const strong = await fetchStatic({root: dir, etag: 'strong'}, {path: '/f.txt'})
		ok(strong.headers['etag'], 'strong etag present')
		ok(!strong.headers['etag'].startsWith('W/'), 'strong etag is not weak')

		const disabled = await fetchStatic({root: dir, etag: 'disabled'}, {path: '/f.txt'})
		strictEqual(disabled.headers['etag'], undefined)

		const weak = await fetchStatic({root: dir}, {path: '/f.txt'})
		ok(weak.headers['etag'], 'default (weak/stat) etag present')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('cache-control options', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'x')

		strictEqual(
			(await fetchStatic({root: dir, maxAge: 1000}, {path: '/f.txt'})).headers['cache-control'],
			'public, max-age=1',
		)
		match((await fetchStatic({root: dir, immutable: true}, {path: '/f.txt'})).headers['cache-control'], /immutable/)
		strictEqual(
			(await fetchStatic({root: dir, disableCacheControl: true}, {path: '/f.txt'})).headers['cache-control'],
			undefined,
		)
		strictEqual(
			(await fetchStatic({root: dir, disableLastModified: true}, {path: '/f.txt'})).headers['last-modified'],
			undefined,
		)
		strictEqual(
			(await fetchStatic({root: dir, disableAcceptRanges: true}, {path: '/f.txt'})).headers['accept-ranges'],
			undefined,
		)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('range request: single range -> 206', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'ABCDEFGHIJ')
		const r = await fetchStatic({root: dir}, {path: '/f.txt', headers: {range: 'bytes=0-4'}})
		strictEqual(r.status, 206)
		strictEqual(r.headers['content-range'], 'bytes 0-4/10')
		strictEqual(r.headers['content-length'], '5')
		strictEqual(r.body.toString(), 'ABCDE')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('range request: multiple ranges -> full 200', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'ABCDEFGHIJ')
		const r = await fetchStatic({root: dir}, {path: '/f.txt', headers: {range: 'bytes=0-1,3-4'}})
		strictEqual(r.status, 200)
		strictEqual(r.body.toString(), 'ABCDEFGHIJ')
		strictEqual(r.headers['content-range'], undefined)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('range request: unsatisfiable -> 416', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'ABCDEFGHIJ')
		const r = await fetchStatic({root: dir}, {path: '/f.txt', headers: {range: 'bytes=999-1000'}})
		strictEqual(r.status, 416)
		strictEqual(r.headers['content-range'], 'bytes */10')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('range request: If-Range matching etag -> 206; stale -> full 200', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'ABCDEFGHIJ')
		const first = await fetchStatic({root: dir}, {path: '/f.txt'})
		const etag = first.headers['etag']

		const fresh = await fetchStatic({root: dir}, {path: '/f.txt', headers: {range: 'bytes=0-4', 'if-range': etag}})
		strictEqual(fresh.status, 206)
		strictEqual(fresh.body.toString(), 'ABCDE')

		const stale = await fetchStatic(
			{root: dir},
			{path: '/f.txt', headers: {range: 'bytes=0-4', 'if-range': '"nomatch"'}},
		)
		strictEqual(stale.status, 200)
		strictEqual(stale.body.toString(), 'ABCDEFGHIJ')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('range request: If-Range as date (fresh -> 206, stale -> full 200)', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'ABCDEFGHIJ')
		const first = await fetchStatic({root: dir}, {path: '/f.txt'})
		const lastModified = first.headers['last-modified']

		// If-Range date >= Last-Modified -> not modified -> honor the range (206)
		const future = new Date(Date.parse(lastModified) + 60 * 60 * 1000).toUTCString()
		const fresh = await fetchStatic({root: dir}, {path: '/f.txt', headers: {range: 'bytes=0-4', 'if-range': future}})
		strictEqual(fresh.status, 206)
		strictEqual(fresh.body.toString(), 'ABCDE')

		// If-Range date < Last-Modified -> stale -> full 200
		const past = new Date(Date.parse(lastModified) - 60 * 60 * 1000).toUTCString()
		const stale = await fetchStatic({root: dir}, {path: '/f.txt', headers: {range: 'bytes=0-4', 'if-range': past}})
		strictEqual(stale.status, 200)
		strictEqual(stale.body.toString(), 'ABCDEFGHIJ')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('conditional GET: if-none-match matching -> 304', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'hello')
		const first = await fetchStatic({root: dir}, {path: '/f.txt'})
		const etag = first.headers['etag']

		const matched = await fetchStatic({root: dir}, {path: '/f.txt', headers: {'if-none-match': etag}})
		strictEqual(matched.status, 304)
		strictEqual(matched.body.length, 0)

		const star = await fetchStatic({root: dir}, {path: '/f.txt', headers: {'if-none-match': '*'}})
		strictEqual(star.status, 304)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('conditional GET: if-modified-since in the future -> 304', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'hello')
		const future = new Date(Date.now() + 60 * 60 * 1000).toUTCString()
		const r = await fetchStatic({root: dir}, {path: '/f.txt', headers: {'if-modified-since': future}})
		strictEqual(r.status, 304)
		strictEqual(r.body.length, 0)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('conditional GET: if-match', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'hello')
		const wrong = await fetchStatic({root: dir}, {path: '/f.txt', headers: {'if-match': '"wrong"'}})
		strictEqual(wrong.status, 412)

		const star = await fetchStatic({root: dir}, {path: '/f.txt', headers: {'if-match': '*'}})
		strictEqual(star.status, 200)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('conditional GET: if-unmodified-since in the past -> 412', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'hello')
		const past = new Date(Date.now() - 60 * 60 * 1000).toUTCString()
		const r = await fetchStatic({root: dir}, {path: '/f.txt', headers: {'if-unmodified-since': past}})
		strictEqual(r.status, 412)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('HEAD request -> 200, headers set, empty body', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'hello there')
		const r = await fetchStatic({root: dir}, {method: 'HEAD', path: '/f.txt'})
		strictEqual(r.status, 200)
		strictEqual(r.headers['content-length'], '11')
		strictEqual(r.body.length, 0)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('dotfiles: forbidden by default, allowed with allowDotfiles', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, '.secret'), 'classified')
		strictEqual((await fetchStatic({root: dir}, {path: '/.secret'})).status, 403)
		const allowed = await fetchStatic({root: dir, allowDotfiles: true}, {path: '/.secret'})
		strictEqual(allowed.status, 200)
		strictEqual(allowed.body.toString(), 'classified')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('security: null byte in path -> 403', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'x')
		// %00 decodes to a null byte in the pathname
		const r = await fetchStatic({root: dir}, {path: '/f%00.txt'})
		strictEqual(r.status, 403)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('security: .. traversal -> 403', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'x')
		// %2f keeps the slash encoded so the URL parser does not resolve the .. segment away;
		// the pathname survives as /..%2fsecret and decodes to /../secret -> traversal check
		const r = await fetchStatic({root: dir}, {path: '/..%2fsecret'})
		strictEqual(r.status, 403)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('security: directory request -> 403', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		mkdirSync(join(dir, 'sub'))
		writeFileSync(join(dir, 'sub', 'f.txt'), 'x')
		const r = await fetchStatic({root: dir}, {path: '/sub'})
		strictEqual(r.status, 403)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('missing file -> 404', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		const r = await fetchStatic({root: dir}, {path: '/does-not-exist.txt'})
		strictEqual(r.status, 404)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('EACCES unreadable file -> 403', {skip: isRoot ? 'chmod 000 does not deny root' : false}, async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	const filePath = join(dir, 'locked.txt')
	try {
		writeFileSync(filePath, 'secret')
		chmodSync(filePath, 0o000)
		const r = await fetchStatic({root: dir}, {path: '/locked.txt'})
		strictEqual(r.status, 403)
	} finally {
		chmodSync(filePath, 0o600)
		rmSync(dir, {recursive: true, force: true})
	}
})

test('getPathname option serves a fixed file regardless of URL', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		const filePath = join(dir, 'fixed.txt')
		writeFileSync(filePath, 'FIXED CONTENT')
		const r = await fetchStatic({getPathname: () => filePath}, {path: '/anything/at/all'})
		strictEqual(r.status, 200)
		strictEqual(r.body.toString(), 'FIXED CONTENT')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('non-GET/HEAD method -> next() -> fallback 404', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'x')
		const r = await fetchStatic({root: dir}, {method: 'POST', path: '/f.txt'})
		strictEqual(r.status, 404)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('pattern miss -> next() -> fallback 404', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		writeFileSync(join(dir, 'f.txt'), 'x')
		const r = await fetchStatic({root: dir}, {pattern: '/assets/*', path: '/other'})
		strictEqual(r.status, 404)
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('no-root mode: getPathname serves an absolute temp file', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		const filePath = join(dir, 'abs.txt')
		writeFileSync(filePath, 'ABSOLUTE')
		const r = await fetchStatic({getPathname: () => filePath}, {path: '/x'})
		strictEqual(r.status, 200)
		strictEqual(r.body.toString(), 'ABSOLUTE')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('no-root mode: start/end slices the file', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-static-'))
	try {
		const filePath = join(dir, 'slice.txt')
		writeFileSync(filePath, 'ABCDEFGHIJ')
		const r = await fetchStatic({start: 2, end: 5, getPathname: () => filePath}, {path: '/x'})
		strictEqual(r.status, 200)
		strictEqual(r.body.toString(), 'CDEF')
		strictEqual(r.headers['content-length'], '4')
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('disableFollowSymlinks: symlink escaping root -> 403', async () => {
	const root = mkdtempSync(join(tmpdir(), 'dx-static-root-'))
	const outside = mkdtempSync(join(tmpdir(), 'dx-static-out-'))
	try {
		const target = join(outside, 'secret.txt')
		writeFileSync(target, 'OUTSIDE')
		const link = join(root, 'link.txt')
		symlinkSync(target, link)

		const denied = await fetchStatic({root, disableFollowSymlinks: true}, {path: '/link.txt'})
		strictEqual(denied.status, 403)

		// without disableFollowSymlinks, the symlink is followed
		const followed = await fetchStatic({root}, {path: '/link.txt'})
		strictEqual(followed.status, 200)
		strictEqual(followed.body.toString(), 'OUTSIDE')
	} finally {
		rmSync(root, {recursive: true, force: true})
		rmSync(outside, {recursive: true, force: true})
	}
})

async function fetchStatic(options: Options, opts: FetchOpts = {}) {
	const pattern = opts.pattern ?? '/*'
	const server = new Server((req, res) => {
		void dxServer(
			req,
			res,
		)(() =>
			chainStatic(
				pattern,
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
	const port = await new Promise<number>(resolve =>
		server.listen(0, () => resolve((server.address() as AddressInfo).port)),
	)
	try {
		return await new Promise<Result>((resolve, reject) => {
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
