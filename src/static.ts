import {Chainable, getReq, getRes} from './dx.js'
import {SendOptions} from './send.js'
import {urlFromReq} from './bodyHelpers.js'
import {sendFile} from './staticHelpers.js'

export function chainStatic(
	pattern: string,
	{getPathname, ...options}: SendOptions & {
		getPathname?(matched: any): string // should keep the heading slash
		// by default: get the full path
	}
): Chainable {
	const urlPattern = new URLPattern({pathname: pattern})
	return async next => {
		const req = getReq()
		if (req.method !== 'GET' && req.method !== 'HEAD') return next()

		const {pathname} = urlFromReq(req)
		const matched = urlPattern.exec({pathname})
		if (!matched) return next()

		await sendFile(
			req,
			getRes(),
			getPathname?.(matched) ?? pathname,
			options,
			next, // if request's pathname matches pattern, but file is not found, next() will be called with error
		)
	}
}
