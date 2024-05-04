import {IncomingMessage} from 'node:http'
import {getContentStream, readStream} from './stream.js'
import {parseContentType} from './contentType.js'

export interface BufferBodyOptions {
	bodyLimit: number
	urlEncodedParser?(search: string): any
	queryParser?(search: string): any
}

function defaultQueryParser(search: string) {
	return Object.fromEntries(new URLSearchParams(search))
}

let bodyDefaultOptions: BufferBodyOptions = {bodyLimit: 100 << 10} // 100kb
export function setBufferBodyDefaultOptions(options: Partial<BufferBodyOptions>) {
	bodyDefaultOptions = {...bodyDefaultOptions, ...options}
}

export async function bufferFromReq(req: IncomingMessage, options?: Partial<BufferBodyOptions>) {
	const {bodyLimit} = {...bodyDefaultOptions, ...options}
	/**
	 * Check if a request has a request body.
	 * A request with a body __must__ either have `transfer-encoding`
	 * or `content-length` headers set.
	 * http://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html#sec4.3
	 */
		// https://github.com/jshttp/type-is/blob/cdcfe23e9833872e425b0aaf71ca0311373b6116/index.js#L92
	const contentLengthParsed = parseInt(req.headers['content-length'] ?? '', 10)
	if (
		req.headers['transfer-encoding'] === undefined
		&& isNaN(contentLengthParsed)
	) return
	const contentLength = isNaN(contentLengthParsed) ? undefined : contentLengthParsed

	// read
	const encoding = (req.headers['content-encoding'] ?? 'identity').toLowerCase()
	const stream = getContentStream(req, encoding)
	return await readStream(
		stream,
		{
			length: encoding === 'identity' ? contentLength : undefined,
			limit: bodyLimit,
		}
	)
}

// if content-type is not as expected, return undefined
function forceGetContentTypeParams(req: IncomingMessage, expected: string){
	const contentTypeRaw = req.headers['content-type']
	if (!contentTypeRaw) return
	const {mediaType, parameters} = parseContentType(contentTypeRaw)
	if (mediaType !== expected) return

	return parameters
}
function forceGetCharset(req: IncomingMessage, expected: string) {
	const parameters = forceGetContentTypeParams(req, expected)
	if (!parameters) return
	// assert charset per RFC 7159 sec 8.1
	const charset = parameters.charset?.toLowerCase() as BufferEncoding || 'utf-8'
	if (!charset.startsWith('utf-')) throw new Error(`unsupported charset "${charset.toUpperCase()}"`)

	return charset
}

export async function jsonFromReq(req: IncomingMessage, options?: Partial<BufferBodyOptions>) {
	const charset = forceGetCharset(req, 'application/json')
	if (!charset) return
	const buffer = await bufferFromReq(req, options)
	if (buffer) {
		const str = buffer.toString(charset)
		return str ? JSON.parse(str) : undefined
	}
}

export async function rawFromReq(req: IncomingMessage, options?: Partial<BufferBodyOptions>) {
	if (!forceGetContentTypeParams(req, 'application/octet-stream')) return
	return await bufferFromReq(req, options)
}

export async function textFromReq(req: IncomingMessage, options?: Partial<BufferBodyOptions>) {
	const charset = forceGetCharset(req, 'text/plain')
	if (!charset) return
	const buffer = await bufferFromReq(req, options)
	if (buffer) return buffer.toString(charset)
}

export async function urlEncodedFromReq(req: IncomingMessage, options?: Partial<BufferBodyOptions>) {
	const charset = forceGetCharset(req, 'application/x-www-form-urlencoded')
	if (!charset) return
	const buffer = await bufferFromReq(req, options)
	if (buffer) {
		return (bodyDefaultOptions.urlEncodedParser ?? options?.urlEncodedParser ?? defaultQueryParser)(buffer.toString(charset))
	}
}

export function urlFromReq(req: IncomingMessage) {
	return new URL(req.url ?? '', 'https://example.com')
}

export function queryFromReq(req: IncomingMessage, options?: Partial<BufferBodyOptions>) {
	return (bodyDefaultOptions.urlEncodedParser ?? options?.urlEncodedParser ?? defaultQueryParser)(urlFromReq(req).searchParams.toString())
}
