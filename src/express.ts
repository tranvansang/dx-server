import makeDefer from 'jdefer'
import {promisify} from 'node:util'
import {entityTag, isFreshETag} from './etag.js'
import {makeContext, requestContext, responseContext} from './context.js'

export const expressContext = makeContext(async (
	{jsonBeautify}: {
		jsonBeautify?: boolean
	} = {}
) => {
	return {
		beautify: jsonBeautify,
	} as
		{
			charset?: BufferEncoding // not for redirect
			beautify?: boolean // json only
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
		)
}, async (ret, {type, data, charset, beautify}) => {
	const res = responseContext.value
	const setContentType = (contentType: string) => {
		if (res.headersSent || res.getHeader('content-type')) return
		res.setHeader('content-type', `${contentType}${charset ? `; charset=${charset}` : ''}`)
	}
	let buffer

	switch (type) {
		case 'text':
			setContentType('text/plain')
		case 'html':
			setContentType('text/html')
			// shared with text
			buffer = Buffer.from(data, charset)
			break
		case 'buffer':
			setContentType('application/octet-stream')
			buffer = data
			break
		case 'json':
			setContentType('application/json')
			buffer = Buffer.from(beautify ? JSON.stringify(data, null, 2) : JSON.stringify(data), charset)
			break
		case 'redirect':
			buffer = Buffer.from(data, charset)
			break
		case undefined:
			// not found
			buffer = Buffer.from('not found', charset)
			res.statusCode = 404
			break
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
		} else await promisify(res.end.bind(res))() // to be consistent, we end the response immediately
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
			// support: 304 (etag), zipping, file etag and last modified
			res.setHeader('content-length', buffer.length)
			const etag = entityTag(buffer)
			const lastModified = res.getHeader('last-modified')

			res.setHeader('ETag', etag)
			if (isFreshETag(req, etag)) {
				res.removeHeader('content-type')
				res.removeHeader('content-length')
				res.removeHeader('transfer-encoding')
				res.statusCode = 304
				// write nothing
			} else res.write(buffer)
			// fixme: not support content-encoding (gzip, deflate, br) for now
		}

		await promisify(res.end.bind(res))()
	}
	return ret
})

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

export function setJson(json: any, {status, beautify}: {
	status?: number
	beautify?: boolean
} = {}) {
	const response = responseContext.value
	if (status) response.statusCode = status

	const express = expressContext.value
	express.data = json
	express.type = 'json'
	if (beautify !== undefined) express.beautify = beautify
}

export function setRedirect(url: string, status: 301 | 302) {
	const response = responseContext.value
	const express = expressContext.value
	response.statusCode = status
	express.data = url
	express.type = 'redirect'
}
