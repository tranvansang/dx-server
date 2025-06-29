import {getReq, makeDxContext} from './dx.ts'
import {
	type BufferBodyOptions,
	bufferFromReq,
	jsonFromReq,
	queryFromReq,
	rawFromReq,
	textFromReq,
	urlEncodedFromReq
} from './bodyHelpers.ts'

export const getBuffer = makeDxContext((options?: Partial<BufferBodyOptions>) => bufferFromReq(getReq(), options))
export const getJson = makeDxContext((options?: Partial<BufferBodyOptions>) => jsonFromReq(getReq(), options))
export const getRaw = makeDxContext((options?: Partial<BufferBodyOptions>) => rawFromReq(getReq(), options))
export const getText = makeDxContext((options?: Partial<BufferBodyOptions>) => textFromReq(getReq(), options))
export const getUrlEncoded = makeDxContext((options?: Partial<BufferBodyOptions>) => urlEncodedFromReq(getReq(), options))
export const getQuery = makeDxContext((options?: Partial<BufferBodyOptions>) => queryFromReq(getReq(), options))

// to getFile use busboy
// https://github.com/mscdex/busboy
