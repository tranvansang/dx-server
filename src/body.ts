import {getContentStream, readStream} from './stream.js'
import {parse} from 'qs'
import {parseContentType} from './contentType.js'
import {makeContext, requestContext} from './context.js'

export const bufferBodyContext = makeContext(async (
	{
		limit = 100 << 10, // 100kb
	}: {
		limit?: number // limit in bytes
	} = {}
) => {
	const req = requestContext.value

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
			limit,
		}
	)
})
const forceGetContentTypeParams = (expected: string) => {
	const req = requestContext.value

	const contentTypeRaw = req.headers['content-type']
	if (!contentTypeRaw) return
	const {mediaType, parameters} = parseContentType(contentTypeRaw)
	if (mediaType !== expected) return

	return parameters
}
const forceGetCharset = (expected: string) => {
	const parameters = forceGetContentTypeParams(expected)
	if (!parameters) return
	// assert charset per RFC 7159 sec 8.1
	const charset = parameters.charset?.toLowerCase() as BufferEncoding || 'utf-8'
	if (!charset.startsWith('utf-')) throw new Error(`unsupported charset "${charset.toUpperCase()}"`)

	return charset
}
export const jsonBodyContext = makeContext(async () => {
	const charset = forceGetCharset('application/json')
	if (!charset) return
	const buffer = bufferBodyContext.value
	if (buffer) {
		const str = buffer.toString(charset)
		return str ? JSON.parse(str) : undefined
	}
})
export const rawBodyContext = makeContext(async () => {
	if (!forceGetContentTypeParams('application/octet-stream')) return
	return bufferBodyContext.value
})
export const textBodyContext = makeContext(async () => {
	const charset = forceGetCharset('text/plain')
	if (!charset) return
	const buffer = bufferBodyContext.value
	if (buffer) return buffer.toString(charset)
})
export const urlencodedBodyContext = makeContext(async (
	{simplify}: {
		simplify?: boolean
	} = {}
) => {
	const charset = forceGetCharset('application/x-www-form-urlencoded')
	if (!charset) return
	const buffer = bufferBodyContext.value
	if (buffer) {
		const str = buffer.toString(charset)
		return simplify
			? Object.fromEntries(new URLSearchParams(str))
			: parse(str)
	}
})

export const queryContext = makeContext(() => {
	const req = requestContext.value
	const query = req.url?.split('?', 2)?.[1]
	return query ? parse(query) : {}
})
