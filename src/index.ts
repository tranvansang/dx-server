export {
	getReq,
	getRes,
	setHtml,
	setNodeStream,
	setWebStream,
	setJson,
	setBuffer,
	setRedirect,
	setText
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

export default dxServer
