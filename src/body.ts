import {getReq} from './dx.js'
import {
	BufferBodyOptions,
	bufferFromReq,
	jsonFromReq,
	queryFromReq,
	rawFromReq,
	textFromReq,
	urlEncodedFromReq
} from './bodyHelpers.js'

const bufferBodySymbol = Symbol('bufferBody')
async function getBuffer(options?: Partial<BufferBodyOptions>) {
	return getReq()[bufferBodySymbol] ??= bufferFromReq(getReq(), options)
}

const jsonBodySymbol = Symbol('jsonBody')
export async function getJson(options?: Partial<BufferBodyOptions>) {
	return getReq()[jsonBodySymbol] ??= jsonFromReq(getReq(), options)
}

const rawBodySymbol = Symbol('rawBody')
export async function getRaw(options?: Partial<BufferBodyOptions>) {
	return getReq()[rawBodySymbol] ??= rawFromReq(getReq(), options)
}

const textBodySymbol = Symbol('textBody')
export async function getText(options?: Partial<BufferBodyOptions>) {
	return getReq()[textBodySymbol] ??= textFromReq(getReq(), options)
}

const urlEncodedBodySymbol = Symbol('urlencodedBody')
export async function getUrlEncoded(options: Partial<BufferBodyOptions>) {
	return getReq()[urlEncodedBodySymbol] ??= urlEncodedFromReq(getReq(), options)
}

const querySymbol = Symbol('query')
export async function getQuery({simplify, ...options}: Partial<BufferBodyOptions> & {simplify?: boolean} = {}) {
	return getReq()[querySymbol] ??= queryFromReq(getReq(), options)
}

// to getFile use busboy
// https://github.com/mscdex/busboy
