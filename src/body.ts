import {getContentStream, readStream} from './stream.js'
import {parse} from 'qs'
import {parseContentType} from './contentType.js'
import {reqContext} from './context.js'

interface BufferBodyOptions {
	limit: number
}
let bufferBodyDefaultOptions: BufferBodyOptions = {limit: 100 << 10} // 100kb
export function setBufferBodyDefaultOptions(options: Partial<BufferBodyOptions>) {
	bufferBodyDefaultOptions = {...bufferBodyDefaultOptions, ...options}
}
const bufferBodySymbol = Symbol('bufferBody')
export async function getBuffer(options?: Partial<BufferBodyOptions>) {
	const {limit} = {...bufferBodyDefaultOptions, ...options}
	const req = reqContext.value
	return req[bufferBodySymbol] ??= (async () => {
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
	})()
}

// if content-type is not as expected, return undefined
function forceGetContentTypeParams(expected: string){
	const req = reqContext.value

	const contentTypeRaw = req.headers['content-type']
	if (!contentTypeRaw) return
	const {mediaType, parameters} = parseContentType(contentTypeRaw)
	if (mediaType !== expected) return

	return parameters
}
function forceGetCharset(expected: string) {
	const parameters = forceGetContentTypeParams(expected)
	if (!parameters) return
	// assert charset per RFC 7159 sec 8.1
	const charset = parameters.charset?.toLowerCase() as BufferEncoding || 'utf-8'
	if (!charset.startsWith('utf-')) throw new Error(`unsupported charset "${charset.toUpperCase()}"`)

	return charset
}

const jsonBodySymbol = Symbol('jsonBody')
export async function getJson(options?: Partial<BufferBodyOptions>) {
	return reqContext.value[jsonBodySymbol] ??= (async () => {
		const charset = forceGetCharset('application/json')
		if (!charset) return
		const buffer = await getBuffer(options)
		if (buffer) {
			const str = buffer.toString(charset)
			return str ? JSON.parse(str) : undefined
		}
	})()
}

const rawBodySymbol = Symbol('rawBody')
export async function getRaw(options?: Partial<BufferBodyOptions>) {
	return reqContext.value[rawBodySymbol] ??= (async () => {
		if (!forceGetContentTypeParams('application/octet-stream')) return
		return await getBuffer(options)
	})()
}

const textBodySymbol = Symbol('textBody')
export async function getText(options?: Partial<BufferBodyOptions>) {
	return reqContext.value[textBodySymbol] ??= (async () => {
		const charset = forceGetCharset('text/plain')
		if (!charset) return
		const buffer = await getBuffer(options)
		if (buffer) return buffer.toString(charset)
	})()
}

const urlEncodedBodySymbol = Symbol('urlencodedBody')
export async function getUrlEncoded({simplify, ...options}: Partial<BufferBodyOptions> & {simplify?: boolean} = {}) {
	return reqContext.value[urlEncodedBodySymbol] ??= (async () => {
		const charset = forceGetCharset('application/x-www-form-urlencoded')
		if (!charset) return
		const buffer = await getBuffer(options)
		if (buffer) {
			const str = buffer.toString(charset)
			return simplify
				? Object.fromEntries(new URLSearchParams(str))
				: parse(str)
		}
	})()
}

const querySymbol = Symbol('query')
export async function getQuery({simplify, ...options}: Partial<BufferBodyOptions> & {simplify?: boolean} = {}) {
	return reqContext.value[querySymbol] ??= (async () => {
		const query = reqContext.value.url?.split('?', 2)?.[1]
		return query
			? simplify
				? Object.fromEntries(new URLSearchParams(query))
				: parse(query)
			: {}
	})()
}
