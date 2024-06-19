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
} from './dx.js'
import {dxServer} from './dx.js'
export {
	getBuffer,
	getJson,
	getRaw,
	getText,
	getUrlEncoded,
	getQuery,
} from './body.js'
export {router} from './router.js'
export {connectMiddlewares} from './connect.js'
export {chainStatic} from './static.js'

export default dxServer
