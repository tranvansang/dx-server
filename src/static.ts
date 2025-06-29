import {Chainable, getReq, getRes} from './dx.js'
import type {SendOptions} from './staticHelpers.js'
import {sendFile} from './staticHelpers.js'
import {urlFromReq} from './bodyHelpers.js'

export function chainStatic(
	pattern: string,
	{getPathname, ...options}: SendOptions & {
		getPathname?(matched: any): string // should keep the heading slash
		// return URI-encoded pathname
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

		try {
			await sendFile(
				req,
				getRes(),
					getPathname?.(matched)
				?? decodeURIComponent(pathname),
				options,
			)
		} catch (e) {
			return next(e) // if request's pathname matches pattern, but file is not found, next() will be called with error
		}
	}
}
