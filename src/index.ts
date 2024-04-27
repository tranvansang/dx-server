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
} from './dx.js'
import {dxServer} from './dx.js'
export {
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
