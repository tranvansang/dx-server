import {reqContext, resContext} from './context.js'
import type {Chainable} from 'jchain'

export const serveFile = (
	{prefix = ''}: {
		prefix?: string
	}
): Chainable => next => {
	const req = reqContext.value
	const res = resContext.value
	if (req.method !== 'GET' && req.method !== 'HEAD') return next()
}
