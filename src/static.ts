import {type Chainable, getReq, getRes} from './dx.js'
import {type SendFileOptions, sendFileTrusted} from './staticHelpers.js'
import {urlFromReq} from './bodyHelpers.js'

export function chainStatic(
	pattern: string,
	{
		getPathname,
		...options
	}: SendFileOptions & {
		// return URI-encoded pathname
		// by default: get the full path
		getPathname?(matched: any): string // should keep the heading slash
	},
): Chainable {
	const urlPattern = new URLPattern({pathname: pattern})
	return async next => {
		const req = getReq()
		if (req.method !== 'GET' && req.method !== 'HEAD') return next()

		const {pathname} = urlFromReq(req)
		const matched = urlPattern.exec({pathname})
		if (!matched) return next()

		const res = getRes()
		try {
			await sendFileTrusted(req, res, getPathname?.(matched) ?? decodeURIComponent(pathname), options)
		} catch (e) {
			if (!res.headersSent) return next(e) // pre-stream error: user error middleware can still respond
		}
	}
}
