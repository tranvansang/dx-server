import makeDefer from 'jdefer'
import {promisify} from 'node:util'
import {entityTag, isFreshETag} from './etag.js'
import {Readable} from 'node:stream'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {AsyncLocalStorage} from 'node:async_hooks'

interface Chainable<
	P extends any[] = any[],
	R = any,
	Next = (...np: any[]) => any,
> {
	(next: Next, ...p: P): R
}

type DxContext = {
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
const reqStorage = new AsyncLocalStorage<IncomingMessage>()
const resStorage = new AsyncLocalStorage<ServerResponse>()
const dxStorage = new AsyncLocalStorage<DxContext>()
export function dxServer(
	req: IncomingMessage,
	res: ServerResponse,
	options: {
		jsonBeautify?: boolean
		disableEtag?: boolean
	} = {}
): Chainable {
	return async next => {
		const dx: DxContext = {...options}
		const result = await dxStorage.run(
			dx,
			() => reqStorage.run(
				req,
				() => resStorage.run(res, next)
			)
		)
		const {type, data, charset, jsonBeautify, disableEtag} = dx
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
				return result
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
		return result
	}
}

// method: verb
// url: full url without server, protocol, port.
// headers: if headers are repeated, they are joined by comma. Header names are lowercased.
// rawHeaders: list of header name and value in a flat array. Case is preserved.
export function getReq(): IncomingMessage {
	return reqStorage.getStore()!
}
export function getRes(): ServerResponse {
	return resStorage.getStore()!
}

// todo: support setFile (with stream or with buffer)

export function setText(text: string, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxStorage.getStore()!
	if (status) res.statusCode = status
	dx.data = text
	dx.type = 'text'
}

export function setHtml(html: string, opts: { status?: number } = {}) {
	setText(html, opts)
	const dx = dxStorage.getStore()!
	dx.type = 'html'
}

export function setBuffer(buffer: Buffer, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxStorage.getStore()!
	if (status) res.statusCode = status
	dx.data = buffer
	dx.type = 'buffer'
}

export function setNodeStream(stream: Readable, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxStorage.getStore()!
	if (status) res.statusCode = status
	dx.data = stream
	dx.type = 'nodeStream'
}

export function setWebStream(stream: ReadableStream, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxStorage.getStore()!
	if (status) res.statusCode = status
	dx.data = stream
	dx.type = 'webStream'
}

export function setJson(json: any, {status, beautify}: {
	status?: number
	beautify?: boolean
} = {}) {
	const res = getRes()
	if (status) res.statusCode = status

	const dx = dxStorage.getStore()!
	dx.data = json
	dx.type = 'json'
	if (beautify !== undefined) dx.jsonBeautify = beautify
}

export function setRedirect(url: string, status: 301 | 302) {
	const res = getRes()
	const dx = dxStorage.getStore()!
	res.statusCode = status
	dx.data = url
	dx.type = 'redirect'
}
