import type {IncomingMessage, ServerResponse} from 'node:http'
import {Readable} from 'node:stream'
import type {ReadableStream as WebReadableStream} from 'node:stream/web'
import {pipeline} from 'node:stream/promises'
import {promisify} from 'node:util'
import {entityTag, isFreshETag} from './vendors/etag.js'
import {sendFileTrusted, type SendFileOptions, type HttpError} from './staticHelpers.js'

export type DxContext = {
	charset?: BufferEncoding // not for redirect
	jsonBeautify?: boolean // json only
	disableEtag?: boolean
} & (
	| {
			type: 'empty'
			data: undefined
			options: undefined
	  }
	| {
			type: 'text'
			data: string
			options: undefined
	  }
	| {
			type: 'html'
			data: string
			options: undefined
	  }
	| {
			type: 'buffer'
			data: Buffer
			options: undefined
	  }
	| {
			type: 'json'
			data: any
			options: undefined
	  }
	| {
			type: 'redirect'
			data: string
			options: undefined
	  }
	| {
			type: 'nodeStream'
			data: Readable
			options: undefined
	  }
	| {
			type: 'webStream'
			data: WebReadableStream
			options: undefined
	  }
	| {
			type: 'file'
			data: string
			options?: SendFileOptions
	  }
)

export async function writeRes(
	req: IncomingMessage,
	res: ServerResponse,
	{type, data, charset, jsonBeautify, disableEtag, options}: DxContext,
) {
	if (res.headersSent) return

	let buffer: Buffer | undefined

	switch (type) {
		case 'text':
		case 'html':
			setContentType(type === 'html' ? 'text/html' : 'text/plain')
			buffer = Buffer.from(data ?? '', charset)
			break
		case 'buffer':
			setContentType('application/octet-stream')
			buffer = data ?? Buffer.from('', charset)
			break
		case 'json':
			setContentType('application/json')
			buffer =
				data === undefined
					? Buffer.from('', charset)
					: Buffer.from(jsonBeautify ? JSON.stringify(data, null, 2) : JSON.stringify(data), charset)
			break
		case 'redirect':
		case 'empty':
			if (type === 'redirect') res.setHeader('location', data)
			buffer = Buffer.from('', charset)
			break
		// Streaming paths own res.end() themselves (via pipeline/sendFileTrusted) and must be
		// awaited to fulfil the "chain resolves after flush" invariant.
		case 'nodeStream':
		case 'webStream':
			if (!data) {
				buffer = Buffer.from('', charset)
				break
			}
		case 'file':
			setContentType('application/octet-stream')
			try {
				if (type === 'file') await sendFileTrusted(req, res, data, options)
				else if (type === 'nodeStream') await pipeline(data, res)
				else if (type === 'webStream') await pipeline(Readable.fromWeb(data), res)
			} catch (e) {
				// A streaming helper (pipeline/sendFileTrusted) may already have destroyed res on
				// error (e.g. fs open EACCES mid-stream). Calling res.end() on a destroyed response
				// never resolves, so skip it — otherwise the chain hangs forever.
				if (res.destroyed) {
					// nothing to flush; res is already torn down
				} else if (!res.headersSent) {
					res.statusCode = (e as Partial<HttpError>)?.statusCode ?? 500
					await promisify(res.end.bind(res))()
				} else if (!res.writableEnded) res.destroy(e as Error)
				console.error(e)
			}
			await awaitResFinished(res)
			return
		case undefined:
			// No setter was called. End the response with 404 instead of leaving it hung.
			if (!res.headersSent) res.statusCode = 404
			if (!res.writableEnded) await promisify(res.end.bind(res))()
			await awaitResFinished(res)
			return
		default:
			// Unknown type: programming error. Surface it via console.error but still finish
			// res so the invariant holds (chain resolves only after flush).
			console.error(new Error(`unsupported response type ${type satisfies never}`))
			if (!res.headersSent) res.statusCode = 500
			if (!res.writableEnded) await promisify(res.end.bind(res))()
			await awaitResFinished(res)
			return
	}

	// https://github.com/expressjs/express/blob/980d881e3b023db079de60477a2588a91f046ca5/lib/response.js#L210
	// if (res.statusCode === 204) { // No Content
	// 	res.removeHeader('content-type')
	// 	res.removeHeader('content-length')
	// 	res.removeHeader('transfer-encoding')
	// 	// write nothing
	// }
	// if (res.statusCode === 205) { // reset content. Tell client to clear the form, etc.
	// 	res.setHeader('content-length', 0)
	// 	res.removeHeader('transfer-encoding')
	// } else
	if (req.method !== 'HEAD') {
		res.setHeader('content-length', buffer.length)
		// no ETag for redirects: the empty body would share the empty-body tag with other empty
		// responses, so a cached If-None-Match could wrongly 304 a redirect (dropping Location)
		if (!disableEtag && type !== 'redirect') {
			const etag = entityTag(buffer)
			res.setHeader('ETag', etag)
			if (isFreshETag(req, etag)) {
				res.removeHeader('content-type')
				res.removeHeader('content-length')
				res.removeHeader('transfer-encoding')
				res.statusCode = 304
			} else res.write(buffer)
		} else res.write(buffer)
		await promisify(res.end.bind(res))()
	}
	// we do not support content-encoding (gzip, deflate, br) and leave it to reverse proxy or CDN

	await promisify(res.end.bind(res))()

	await awaitResFinished(res)

	function setContentType(contentType: string) {
		if (res.headersSent || res.getHeader('content-type')) return
		res.setHeader('content-type', `${contentType}${charset ? `; charset=${charset}` : ''}`)
	}
}

// Resolves when res is fully flushed (finish) or the socket is gone (close).
// Used as the universal "we're done with this response" signal so every code path
// in writeRes can guarantee the chain doesn't unwind before bytes hit the wire.
function awaitResFinished(res: ServerResponse) {
	if (res.writableFinished || res.destroyed) return Promise.resolve()
	return new Promise<void>(resolve => {
		res.once('finish', done)
		res.once('close', done)
		function done() {
			res.off('finish', done)
			res.off('close', done)
			resolve()
		}
	})
}
