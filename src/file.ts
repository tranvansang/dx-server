import {getReq, getRes} from './dx.js'

export const serveFile = (
	{prefix = ''}: {
		prefix?: string
	}
) => next => {
	const req = getReq()
	const res = getRes()
	if (req.method !== 'GET' && req.method !== 'HEAD') return next()
}
