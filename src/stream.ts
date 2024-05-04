// https://github.com/expressjs/body-parser/blob/2a2f47199b443c56b6ebb74cac7acdeb63fac61f/lib/read.js#L152
import type {IncomingMessage} from 'node:http'
import type {Readable} from 'node:stream'
import {createBrotliDecompress, createGunzip, createInflate} from 'node:zlib'
import './polyfillWithResolvers.js'

// note: there might be multiple encodings applied to the stream
// we only support one encoding
export function getContentStream(req: IncomingMessage, encoding: string, disableInflate?: boolean) {
	if (disableInflate && encoding !== 'identity') throw new Error(`content-encoding ${encoding} is not supported`)

	switch (encoding) {
		case 'deflate': {
			const stream = createInflate()
			req.pipe(stream)
			return stream
		}
		case 'gzip': {
			const stream = createGunzip()
			req.pipe(stream)
			return stream
		}
		case 'br': {
			const stream = createBrotliDecompress()
			req.pipe(stream)
			return stream
		}
		case 'identity':
			return req
		default:
			throw new Error(`unsupported content-encoding ${encoding}`)
	}
}

// https://github.com/stream-utils/raw-body/blob/191e4b6506dcf77198eed01c8feb4b6817008342/index.js#L155
export async function readStream(
	stream: Readable,
	{length, limit}: {
		length?: number
		limit?: number
	}
) {
	let completed = false

	// check the length and limit options.
	// note: we intentionally leave the stream paused,
	// so users should handle the stream themselves.
	if (limit !== undefined && length !== undefined && length > limit) throw new Error('request entity too large')

	let received = 0
	const buffers: Buffer[] = []
	const defer = Promise.withResolvers<Buffer>()

	// attach listeners
	stream.on('aborted', onAborted)
	stream.on('close', onClose)
	stream.on('data', onData)
	stream.on('end', onEnd)
	stream.on('error', onError)

	function done(err?: Error, result?: Buffer) {
		if (completed) return
		completed = true
		onClose()
		if (err) {
			stream.unpipe?.()
			stream.pause?.()
			defer.reject(err)
		} else defer.resolve(result!)
	}

	function onData(chunk: Buffer) {
		if (completed) return
		received += chunk.length
		if (limit !== undefined && received > limit) {
			done(new Error('request entity too large'))
		} else buffers.push(chunk)
	}

	function onError(err: Error) {
		done(err)
	}
	function onEnd() {
		if (length !== undefined && received !== length) done(new Error('request size did not match content length'))
		else done(undefined, Buffer.concat(buffers))
	}
	function onAborted() {
		done(new Error('request aborted'))
	}
	function onClose () {
		buffers.splice(0, buffers.length)
		stream.off('aborted', onAborted)
		stream.off('data', onData)
		stream.off('end', onEnd)
		stream.off('error', onEnd)
		stream.off('close', onClose)
	}

	return await defer.promise
}
