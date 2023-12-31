import makeDefer from 'jdefer'
import {promisify} from 'node:util'
import {entityTag, isFreshETag} from './etag.js'
import {makeContext, requestContext, responseContext} from './context.js'
import {Readable} from 'node:stream'

export const expressContext = makeContext(async (
	{jsonBeautify, disableEtag}: {
		jsonBeautify?: boolean
		disableEtag?: boolean
	} = {}
) => {
	return {
		jsonBeautify,
		disableEtag,
	} as
		{
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
	}
		)
}, async (ret, {type, data, charset, jsonBeautify, disableEtag}) => {
	const res = responseContext.value
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
			return ret
		default:
			if (!res.getHeader('content-type')) res.setHeader('content-type', 'text/plain')
			throw new Error(`unsupported response type ${type}`)
	}

	const req = requestContext.value

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
			// fixme: not support content-encoding (gzip, deflate, br) for now
		}

		await promisify(res.end.bind(res))(undefined) // some express middleware, such as express-session, requires explicitly passing chunk
	}
	return ret
})

// todo: support setFile (with stream or with buffer)

export function setText(text: string, {status}: { status?: number } = {}) {
	const response = responseContext.value
	const express = expressContext.value
	if (status) response.statusCode = status
	express.data = text
	express.type = 'text'
}

export function setHtml(html: string, opts: { status?: number } = {}) {
	setText(html, opts)
	const express = expressContext.value
	express.type = 'html'
}

export function setBuffer(buffer: Buffer, {status}: { status?: number } = {}) {
	const response = responseContext.value
	const express = expressContext.value
	if (status) response.statusCode = status
	express.data = buffer
	express.type = 'buffer'
}

export function setNodeStream(stream: Readable, {status}: { status?: number } = {}) {
	const response = responseContext.value
	const express = expressContext.value
	if (status) response.statusCode = status
	express.data = stream
	express.type = 'nodeStream'
}

export function setWebStream(stream: ReadableStream, {status}: { status?: number } = {}) {
	const response = responseContext.value
	const express = expressContext.value
	if (status) response.statusCode = status
	express.data = stream
	express.type = 'webStream'
}

export function setJson(json: any, {status, beautify}: {
	status?: number
	beautify?: boolean
} = {}) {
	const response = responseContext.value
	if (status) response.statusCode = status

	const express = expressContext.value
	express.data = json
	express.type = 'json'
	if (beautify !== undefined) express.jsonBeautify = beautify
}

export function setRedirect(url: string, status: 301 | 302) {
	const response = responseContext.value
	const express = expressContext.value
	response.statusCode = status
	express.data = url
	express.type = 'redirect'
}
