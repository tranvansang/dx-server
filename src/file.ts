import {requestContext, responseContext} from './context.js'
import type {IChainable} from 'jchain'

export const serveFile = (
	{prefix = ''}: {
		prefix?: string
	}
): IChainable => next => {
	const req = requestContext.value
	const res = responseContext.value
	if (req.method !== 'GET' && req.method !== 'HEAD') return next()
}
