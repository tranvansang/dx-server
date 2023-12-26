import {requestContext, responseContext} from './context.js'
import type {Chainable} from 'jchain'

export const serveFile = (
	{prefix = ''}: {
		prefix?: string
	}
): Chainable => next => {
	const req = requestContext.value
	const res = responseContext.value
	if (req.method !== 'GET' && req.method !== 'HEAD') return next()
}
