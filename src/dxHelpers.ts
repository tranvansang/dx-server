import type {IncomingMessage, ServerResponse} from 'node:http'
import {Readable} from 'node:stream'
import makeDefer from 'jdefer'
import {promisify} from 'node:util'
import {entityTag, isFreshETag} from './etag.js'

export type DxContext = {
	charset?: BufferEncoding // not for redirect
	jsonBeautify?: boolean // json only
	disableEtag?: boolean
} & (
	| {
	type: 'text'
	data: string
}
	| {
	type: 'html'
	data: string
}
	| {
	type: 'buffer'
	data: Buffer
}
	| {
	type: 'json'
	data: any
}
	| {
	type: 'redirect'
	data: string
}
	| {
	type: 'nodeStream'
	data: Readable
}
	| {
	type: 'webStream'
	data: ReadableStream
})

export async function writeRes(req: IncomingMessage, res: ServerResponse, {type, data, charset, jsonBeautify, disableEtag}: DxContext) {
	const setContentType = (contentType: string) => {
		if (res.headersSent || res.getHeader('content-type')) return
		res.setHeader('content-type', `${contentType}${charset ? `; charset=${charset}` : ''}`)
	}
	let bufferOrStream

	switch (type) {
		case 'text':
			setContentType('text/plain')
		case 'html':
			setContentType('text/html')
			// shared with text
			bufferOrStream = Buffer.from(data, charset)
			break
		case 'buffer':
			setContentType('application/octet-stream')
			bufferOrStream = data
			break
		case 'nodeStream':
			setContentType('application/octet-stream')
			bufferOrStream = data
			break
		case 'webStream':
			setContentType('application/octet-stream')
			bufferOrStream = Readable.fromWeb(data as import('node:stream/web').ReadableStream)
			break
		case 'json':
			setContentType('application/json')
			bufferOrStream = Buffer.from(jsonBeautify ? JSON.stringify(data, null, 2) : JSON.stringify(data), charset)
			break
		case 'redirect':
			res.setHeader('location', data)
			bufferOrStream = Buffer.from('', charset)
			break
		case undefined:
			// skip response. Some middleware may handle it outside the chain. For example, express middleware
			return
		default:
			if (!res.getHeader('content-type')) res.setHeader('content-type', 'text/plain')
			throw new Error(`unsupported response type ${type}`)
	}

	if (res.headersSent) {
		if (res.writableFinished) {
			// skipped: response is already finished
		} else if (res.writableEnded) {
			const defer = makeDefer<void>()
			res.addListener('finish', defer.resolve)
			await defer.promise
			// skipped: response is already ended
			// chunk is not fully flushed yet
		} else await promisify(res.end.bind(res))(undefined) // to be consistent, we end the response immediately
	} else {
		// https://github.com/expressjs/express/blob/980d881e3b023db079de60477a2588a91f046ca5/lib/response.js#L210
		if (res.statusCode === 204) { // No Content
			res.removeHeader('content-type')
			res.removeHeader('content-length')
			res.removeHeader('transfer-encoding')
			// write nothing
		}
		if (res.statusCode === 205) { // reset content. Tell client to clear the form, etc.
			res.setHeader('content-length', 0)
			res.removeHeader('transfer-encoding')
		} else if (req.method === 'HEAD') {
			// write nothing
		} else {
			if (Buffer.isBuffer(bufferOrStream)) {
				// support: 304 (etag), zipping, file etag and last modified
				res.setHeader('content-length', bufferOrStream.length)

				if (!disableEtag) {
					const etag = entityTag(bufferOrStream)
					const lastModified = res.getHeader('last-modified')

					res.setHeader('ETag', etag)
					if (isFreshETag(req, etag)) {
						res.removeHeader('content-type')
						res.removeHeader('content-length')
						res.removeHeader('transfer-encoding')
						res.statusCode = 304
						// write nothing
					} else res.write(bufferOrStream)
				} else res.write(bufferOrStream)
			} else {
				bufferOrStream.pipe(res)
			}
			// we do not support content-encoding (gzip, deflate, br) and leave it to reverse proxy or CDN
		}

		await promisify(res.end.bind(res))(undefined) // some express middleware, such as express-session, requires explicitly passing chunk
	}
}