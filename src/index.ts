export {
	getReq,
	getRes,
	setHtml,
	setNodeStream,
	setWebStream,
	setJson,
	setBuffer,
	setRedirect,
	setText,
	setEmpty,
	setFile,
	makeDxContext,
} from './dx.ts'
import {dxServer} from './dx.ts'
export {
	getBuffer,
	getJson,
	getRaw,
	getText,
	getUrlEncoded,
	getQuery,
} from './body.ts'
export {router} from './router.ts'
export {connectMiddlewares} from './connect.ts'
export {chainStatic} from './static.ts'

export default dxServer
