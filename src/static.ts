import {Chainable, getReq, getRes} from './dx.js'
import {SendOptions} from 'send'
import {urlFromReq} from './bodyHelpers.js'
import {sendFile} from './staticHelpers.js'
import {matchPattern} from './router.js'
import {IncomingMessage} from 'node:http'

export function chainStatic(
	pattern: string,
	{getPathname, ...options}: SendOptions & {
		getPathname?: (req: IncomingMessage) => string // should keep the heading slash
		// by default: get the full path
	}
): Chainable {
	return async next => {
		const req = getReq()
		if (req.method !== 'GET' && req.method !== 'HEAD') return next()

		const match = matchPattern(urlFromReq(req).pathname, pattern)
		if (!match) return next()

		try {
			await sendFile(
			req,
			getRes(),
			getPathname?.(req) ?? urlFromReq(req).pathname,
			options,
			next,
		)
		} catch (err) {
			return next(err)
			// if (err.code === 'ENOENT') return next()
			// throw err
		}
	}
}
