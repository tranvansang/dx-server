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
export {router} from './route.js'
export {connectMiddlewares} from './connect.js'
export {chainStatic} from './static.js'

export default dxServer
