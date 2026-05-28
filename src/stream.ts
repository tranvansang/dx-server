// https://github.com/expressjs/body-parser/blob/2a2f47199b443c56b6ebb74cac7acdeb63fac61f/lib/read.js#L152
import type {IncomingMessage} from 'node:http'
import type {Readable} from 'node:stream'
import {createBrotliDecompress, createGunzip, createInflate, createZstdDecompress} from 'node:zlib'

// body errors carry an HTTP status so error middleware can map them (413 too large, 400 malformed)
function bodyError(message: string, statusCode: number) {
	const e = new Error(message) as Error & {statusCode: number}
	e.statusCode = statusCode
	return e
}

// note: there might be multiple encodings applied to the stream
// we only support one encoding
export function getContentStream(req: IncomingMessage, encoding: string) {
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
		case 'zstd': {
			const stream = createZstdDecompress()
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
	{
		length,
		limit,
	}: {
		length?: number
		limit?: number
	},
) {
	let completed = false

	// check the length and limit options.
	// note: we intentionally leave the stream paused,
	// so users should handle the stream themselves.
	if (limit !== undefined && length !== undefined && length > limit) throw bodyError('request entity too large', 413)

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
			done(bodyError('request entity too large', 413))
		} else buffers.push(chunk)
	}

	function onError(err: Error) {
		done(err)
	}
	function onEnd() {
		if (length !== undefined && received !== length) done(bodyError('request size did not match content length', 400))
		else done(undefined, Buffer.concat(buffers))
	}
	function onAborted() {
		done(bodyError('request aborted', 400))
	}
	function onClose() {
		buffers.splice(0, buffers.length)
		stream.off('aborted', onAborted)
		stream.off('data', onData)
		stream.off('end', onEnd)
		stream.off('error', onError)
		stream.off('close', onClose)
	}

	return await defer.promise
}
