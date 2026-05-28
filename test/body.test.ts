import {test} from 'node:test'
import {strictEqual, deepEqual, ok, rejects, throws} from 'node:assert/strict'
import {Readable} from 'node:stream'
import {gzipSync, deflateSync, brotliCompressSync} from 'node:zlib'
import {
	setBufferBodyDefaultOptions,
	bufferFromReq,
	jsonFromReq,
	rawFromReq,
	textFromReq,
	urlEncodedFromReq,
	urlFromReq,
	queryFromReq,
} from '../lib/bodyHelpers.js'
import {getContentStream, readStream} from '../lib/stream.js'

const defaultBodyLimit = 100 << 10

// ---- bufferFromReq -------------------------------------------------------

test('bufferFromReq: no body indicator resolves undefined', async () => {
	const req = mockReq(undefined, {})
	strictEqual(await bufferFromReq(req), undefined)
})

test('bufferFromReq: identity body with correct content-length returns the buffer', async () => {
	const body = 'hello world'
	const req = mockReq(body, {'content-length': String(Buffer.byteLength(body))})
	const buf = await bufferFromReq(req)
	ok(Buffer.isBuffer(buf))
	strictEqual(buf!.toString(), body)
})

test('bufferFromReq: transfer-encoding chunked with no length returns the buffer', async () => {
	const body = 'chunked body'
	const req = mockReq(body, {'transfer-encoding': 'chunked'})
	const buf = await bufferFromReq(req)
	strictEqual(buf!.toString(), body)
})

test('bufferFromReq: up-front content-length > bodyLimit rejects entity too large', async () => {
	const body = 'this is too large'
	const req = mockReq(body, {'content-length': String(Buffer.byteLength(body))})
	await rejects(() => bufferFromReq(req, {bodyLimit: 4}), /request entity too large/)
})

test('bufferFromReq: during-streaming limit (chunked, no length) rejects entity too large', async () => {
	const body = 'this body exceeds the limit while streaming'
	const req = mockReq(body, {'transfer-encoding': 'chunked'})
	await rejects(() => bufferFromReq(req, {bodyLimit: 4}), /request entity too large/)
})

test('bufferFromReq: gzip encoded body decodes correctly', async () => {
	const original = 'gzip payload content'
	const compressed = gzipSync(Buffer.from(original))
	const req = mockReq(compressed, {'content-encoding': 'gzip', 'content-length': String(compressed.length)})
	const buf = await bufferFromReq(req)
	strictEqual(buf!.toString(), original)
})

test('bufferFromReq: deflate encoded body decodes correctly', async () => {
	const original = 'deflate payload content'
	const compressed = deflateSync(Buffer.from(original))
	const req = mockReq(compressed, {'content-encoding': 'deflate', 'content-length': String(compressed.length)})
	const buf = await bufferFromReq(req)
	strictEqual(buf!.toString(), original)
})

test('bufferFromReq: br encoded body decodes correctly', async () => {
	const original = 'brotli payload content'
	const compressed = brotliCompressSync(Buffer.from(original))
	const req = mockReq(compressed, {'content-encoding': 'br', 'content-length': String(compressed.length)})
	const buf = await bufferFromReq(req)
	strictEqual(buf!.toString(), original)
})

test('bufferFromReq: gzip limit exceeded tears down the decompressor and rejects', async () => {
	// inflate a small compressed input into a large body that exceeds the limit
	const original = 'A'.repeat(10000)
	const compressed = gzipSync(Buffer.from(original))
	const req = mockReq(compressed, {'content-encoding': 'gzip', 'content-length': String(compressed.length)})
	await rejects(() => bufferFromReq(req, {bodyLimit: 16}), /request entity too large/)
})

test('bufferFromReq: identity wrong (too-large) content-length rejects on end', async () => {
	const body = 'short'
	const actual = Buffer.byteLength(body)
	const req = mockReq(body, {'content-length': String(actual + 100)})
	await rejects(() => bufferFromReq(req), /request size did not match content length/)
})

test('bufferFromReq: respects bodyLimit set via setBufferBodyDefaultOptions', async () => {
	try {
		setBufferBodyDefaultOptions({bodyLimit: 4})
		const body = 'larger than four'
		const req = mockReq(body, {'content-length': String(Buffer.byteLength(body))})
		await rejects(() => bufferFromReq(req), /request entity too large/)
	} finally {
		setBufferBodyDefaultOptions({bodyLimit: defaultBodyLimit})
	}
})

// ---- jsonFromReq ---------------------------------------------------------

test('jsonFromReq: absent content-type returns undefined', async () => {
	const req = mockReq('{"a":1}', {'content-length': '7'})
	strictEqual(await jsonFromReq(req), undefined)
})

test('jsonFromReq: wrong content-type returns undefined', async () => {
	const req = mockReq('{"a":1}', {'content-type': 'text/plain', 'content-length': '7'})
	strictEqual(await jsonFromReq(req), undefined)
})

test('jsonFromReq: correct content-type parses json', async () => {
	const body = '{"a":1}'
	const req = mockReq(body, {'content-type': 'application/json', 'content-length': String(body.length)})
	deepEqual(await jsonFromReq(req), {a: 1})
})

test('jsonFromReq: empty body with content-type returns undefined', async () => {
	const req = mockReq('', {'content-type': 'application/json', 'content-length': '0'})
	strictEqual(await jsonFromReq(req), undefined)
})

test('jsonFromReq: charset=utf-16le decodes correctly', async () => {
	const obj = {greeting: 'hello'}
	const buf = Buffer.from(JSON.stringify(obj), 'utf16le')
	const req = mockReq(buf, {
		'content-type': 'application/json; charset=utf-16le',
		'content-length': String(buf.length),
	})
	deepEqual(await jsonFromReq(req), obj)
})

test('jsonFromReq: charset=utf-7 throws unsupported charset', async () => {
	const body = '{"a":1}'
	const req = mockReq(body, {'content-type': 'application/json; charset=utf-7', 'content-length': String(body.length)})
	await rejects(() => jsonFromReq(req), /unsupported charset/)
})

// ---- textFromReq ---------------------------------------------------------

test('textFromReq: text/plain returns string', async () => {
	const body = 'plain text body'
	const req = mockReq(body, {'content-type': 'text/plain', 'content-length': String(body.length)})
	strictEqual(await textFromReq(req), body)
})

test('textFromReq: wrong content-type returns undefined', async () => {
	const req = mockReq('plain', {'content-type': 'application/json', 'content-length': '5'})
	strictEqual(await textFromReq(req), undefined)
})

// ---- rawFromReq ----------------------------------------------------------

test('rawFromReq: application/octet-stream returns buffer', async () => {
	const body = Buffer.from([1, 2, 3, 4])
	const req = mockReq(body, {'content-type': 'application/octet-stream', 'content-length': String(body.length)})
	const buf = await rawFromReq(req)
	ok(Buffer.isBuffer(buf))
	deepEqual([...buf!], [1, 2, 3, 4])
})

test('rawFromReq: wrong content-type returns undefined', async () => {
	const req = mockReq('abc', {'content-type': 'text/plain', 'content-length': '3'})
	strictEqual(await rawFromReq(req), undefined)
})

// ---- urlEncodedFromReq ---------------------------------------------------

test('urlEncodedFromReq: default parser parses form body', async () => {
	const body = 'a=1&b=2'
	const req = mockReq(body, {
		'content-type': 'application/x-www-form-urlencoded',
		'content-length': String(body.length),
	})
	deepEqual(await urlEncodedFromReq(req), {a: '1', b: '2'})
})

test('urlEncodedFromReq: wrong content-type returns undefined', async () => {
	const req = mockReq('a=1', {'content-type': 'text/plain', 'content-length': '3'})
	strictEqual(await urlEncodedFromReq(req), undefined)
})

test('urlEncodedFromReq: custom parser via options argument', async () => {
	const body = 'a=1&b=2'
	const req = mockReq(body, {
		'content-type': 'application/x-www-form-urlencoded',
		'content-length': String(body.length),
	})
	const result = await urlEncodedFromReq(req, {urlEncodedParser: (s: string) => ({raw: s})})
	deepEqual(result, {raw: 'a=1&b=2'})
})

test('urlEncodedFromReq: custom parser via setBufferBodyDefaultOptions', async () => {
	try {
		setBufferBodyDefaultOptions({urlEncodedParser: (s: string) => ({fromDefault: s})})
		const body = 'a=1&b=2'
		const req = mockReq(body, {
			'content-type': 'application/x-www-form-urlencoded',
			'content-length': String(body.length),
		})
		deepEqual(await urlEncodedFromReq(req), {fromDefault: 'a=1&b=2'})
	} finally {
		setBufferBodyDefaultOptions({urlEncodedParser: undefined})
	}
})

// ---- queryFromReq --------------------------------------------------------

test('queryFromReq: default parser parses query string', () => {
	const req = mockReq(undefined, {})
	req.url = '/p?a=1&b=2'
	deepEqual(queryFromReq(req), {a: '1', b: '2'})
})

test('queryFromReq: custom parser via options argument', () => {
	const req = mockReq(undefined, {})
	req.url = '/p?a=1&b=2'
	deepEqual(queryFromReq(req, {queryParser: (s: string) => ({opts: s})}), {opts: 'a=1&b=2'})
})

test('queryFromReq: custom parser via setBufferBodyDefaultOptions', () => {
	try {
		setBufferBodyDefaultOptions({queryParser: (s: string) => ({q: s})})
		const req = mockReq(undefined, {})
		req.url = '/p?a=1&b=2'
		deepEqual(queryFromReq(req), {q: 'a=1&b=2'})
	} finally {
		setBufferBodyDefaultOptions({queryParser: undefined})
	}
})

// ---- urlFromReq ----------------------------------------------------------

test('urlFromReq: returns a URL', () => {
	const req = mockReq(undefined, {})
	req.url = '/path?x=1'
	const url = urlFromReq(req)
	ok(url instanceof URL)
	strictEqual(url.pathname, '/path')
	strictEqual(url.searchParams.get('x'), '1')
})

test('urlFromReq: undefined url defaults to empty', () => {
	const req = mockReq(undefined, {})
	req.url = undefined
	const url = urlFromReq(req)
	ok(url instanceof URL)
	strictEqual(url.pathname, '/')
})

// ---- getContentStream ----------------------------------------------------

test('getContentStream: identity returns req itself', () => {
	const req = mockReq(undefined, {})
	strictEqual(getContentStream(req, 'identity'), req)
})

test('getContentStream: gzip returns a transform stream (not req)', () => {
	const req = mockReq('', {})
	const stream = getContentStream(req, 'gzip')
	ok(stream !== req)
	stream.destroy()
})

test('getContentStream: deflate returns a transform stream (not req)', () => {
	const req = mockReq('', {})
	const stream = getContentStream(req, 'deflate')
	ok(stream !== req)
	stream.destroy()
})

test('getContentStream: br returns a transform stream (not req)', () => {
	const req = mockReq('', {})
	const stream = getContentStream(req, 'br')
	ok(stream !== req)
	stream.destroy()
})

test('getContentStream: unsupported encoding throws', () => {
	const req = mockReq(undefined, {})
	throws(() => getContentStream(req, 'unsupported'), /unsupported content-encoding/)
})

test('getContentStream: disableInflate with non-identity encoding throws', () => {
	const req = mockReq(undefined, {})
	throws(() => getContentStream(req, 'gzip', true), /content-encoding gzip is not supported/)
})

test('getContentStream: disableInflate with identity returns req', () => {
	const req = mockReq(undefined, {})
	strictEqual(getContentStream(req, 'identity', true), req)
})

// ---- readStream ----------------------------------------------------------

test('readStream: normal read concatenates buffers', async () => {
	const buf = await readStream(Readable.from([Buffer.from('abc')]), {})
	strictEqual(buf.toString(), 'abc')
})

test('readStream: limit exceeded during data rejects entity too large', async () => {
	const stream = Readable.from([Buffer.from('aaaa'), Buffer.from('bbbb')])
	await rejects(() => readStream(stream, {limit: 5}), /request entity too large/)
})

test('readStream: length mismatch on end rejects size did not match', async () => {
	const stream = Readable.from([Buffer.from('abc')])
	await rejects(() => readStream(stream, {length: 10}), /request size did not match content length/)
})

test('readStream: up-front length > limit rejects before reading', async () => {
	const stream = Readable.from([Buffer.from('abc')])
	await rejects(() => readStream(stream, {length: 100, limit: 10}), /request entity too large/)
})

test('readStream: stream error rejects with that error', async () => {
	const stream = new Readable({read() {}})
	const promise = readStream(stream, {})
	stream.emit('error', new Error('boom'))
	await rejects(() => promise, /boom/)
})

test('readStream: aborted rejects request aborted', async () => {
	const stream = new Readable({read() {}})
	const promise = readStream(stream, {})
	stream.emit('aborted')
	await rejects(() => promise, /request aborted/)
})

test('readStream: matching length resolves', async () => {
	const buf = await readStream(Readable.from([Buffer.from('abcde')]), {length: 5})
	strictEqual(buf.toString(), 'abcde')
})

test('readStream: only the first settlement wins (later events detached)', async () => {
	const stream = new Readable({read() {}})
	const promise = readStream(stream, {})
	stream.emit('error', new Error('boom'))
	// after completion listeners are detached, so this end is ignored and the rejection stands
	stream.emit('end')
	await rejects(() => promise, /boom/)
})

function mockReq(body: Buffer | string | undefined, headers: Record<string, string>) {
	const r = (body === undefined ? Readable.from([]) : Readable.from([Buffer.from(body)])) as any
	r.headers = headers
	return r
}
