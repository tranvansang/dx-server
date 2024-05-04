import {Chainable, getReq, getRes} from './dx.js'
import {SendOptions} from 'send'
import {urlFromReq} from './bodyHelpers.js'
import {sendFile} from './staticHelpers.js'

export function chainStatic(
	prefix: string,
	options: SendOptions
): Chainable {
	return async next => {
		const req = getReq()
		if (req.method !== 'GET' && req.method !== 'HEAD') return next()

		if (!prefix.endsWith('/')) prefix += '/'
		if (!prefix.startsWith('/')) prefix = '/' + prefix

		const {pathname} = urlFromReq(req)
		if (
			!pathname.startsWith(prefix)
			&& !pathname.endsWith('/')
			&& pathname + '/' !== prefix
		) return next()

		try {
			await sendFile(
			req,
			getRes(),
			pathname.slice(prefix.length - 1), // keep the trailing slash
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
