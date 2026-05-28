import {test} from 'node:test'
import {ok, strictEqual} from 'node:assert/strict'
import {Readable} from 'node:stream'
import {createGzip} from 'node:zlib'
import {bufferFromReq} from '../lib/helpers.js'

// C2 regression: when the body limit fires on a compressed request, the decompressor must be
// torn down and unpiped from req. Otherwise req keeps feeding the decompressor and a zip-bomb
// keeps inflating long after the limit "rejected" the request.

test('C2: oversized gzip body is rejected and the decompressor is unpiped from req', async () => {
	// Endless stream of 'A's -> gzip. req never ends, so the only thing that can empty req's
	// pipe set is the explicit unpipe in the fix (not an auto-cleanup on source 'end').
	const raw = new Readable({
		read() {
			this.push(Buffer.alloc(64 * 1024, 0x41))
		},
	})
	const req = raw.pipe(createGzip()) as any
	req.headers = {'content-encoding': 'gzip', 'transfer-encoding': 'chunked'}

	try {
		let rejected = false
		try {
			await bufferFromReq(req, {bodyLimit: 1024})
		} catch (e) {
			rejected = true
			strictEqual((e as Error).message, 'request entity too large')
		}
		ok(rejected, 'oversized gzip body should be rejected by bodyLimit')

		const pipes = req._readableState?.pipes
		const pipeCount = Array.isArray(pipes) ? pipes.length : pipes ? 1 : 0
		strictEqual(pipeCount, 0, 'req still piped to the decompressor — it keeps inflating after the limit (C2)')
	} finally {
		req.destroy()
		raw.destroy()
	}
})
