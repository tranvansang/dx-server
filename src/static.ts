import {Chainable, getReq, getRes} from './dx.js'
import {SendOptions} from 'send'
import {urlFromReq} from './bodyHelpers.js'
import {sendFile} from './staticHelpers.js'

export function chainStatic(
	pattern: string,
	{getPathname, ...options}: SendOptions & {
		getPathname?(matched: URLPatternResult): string // should keep the heading slash
		// by default: get the full path
	}
): Chainable {
	return async next => {
		const req = getReq()
		if (req.method !== 'GET' && req.method !== 'HEAD') return next()

		const {pathname} = urlFromReq(req)
		const matched = new URLPattern({pathname: pattern}).exec({pathname})
		if (!matched) return next()

		try {
			await sendFile(
			req,
			getRes(),
			getPathname?.(matched) ?? pathname,
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
