import {type Chainable, getReq, getRes, setHtml} from './dx.js'
import {sendFileTrusted, type SendOptions} from './staticHelpers.js'
import {urlFromReq} from './bodyHelpers.js'
import {IncomingMessage, ServerResponse} from 'node:http'
import path from 'node:path'

const UP_PATH_REGEXP = /(?:^|[\\/])\.\.(?:[\\/]|$)/

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

async function sendFile(
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string, // plain path, not URI-encoded
	options?: SendOptions,
) {
	const {
		root, dotfiles, start = 0, end,
		disableAcceptRanges, disableLastModified, disableEtag,
		disableCacheControl, maxAge = 60 * 60 * 24 * 365 * 1000, // 1 year
		immutable,
	} = options ?? {}

	// null byte(s)
	if (pathname.includes('\0')) return setHtml('Invalid request', {status: 400})

	let parts: string[]
	if (root) {
		// normalize
		pathname = path.normalize(`.${path.sep}${pathname}`)

		// malicious path
		if (UP_PATH_REGEXP.test(pathname)) return setHtml('Forbidden', {status: 403})

		// explode path parts
		parts = pathname.split(path.sep)

		// join / normalize from optional root dir
		pathname = path.normalize(path.join(root, pathname))
	} else {
		// malicious path
		if (UP_PATH_REGEXP.test(pathname)) return setHtml('Forbidden', {status: 403})

		// explode path parts
		parts = path.normalize(pathname).split(path.sep)

		// join / normalize from optional root dir
		pathname = path.resolve(pathname)
	}

	// dotfile handling
	if (parts.some(part => part.length > 1 && part[0] === '.')) switch (dotfiles) {
		case 'allow':
			break
		case 'deny':
			return setHtml('Forbidden', {status: 403})
		case 'ignore':
		default:
			throw new Error('Forbidden: dotfiles are not allowed')
	}

	// pathEndsWithSep
	if (pathname[pathname.length - 1] === path.sep) return setHtml('Forbidden: directory access is not allowed', {status: 403})

	return sendFileTrusted(req, res, pathname, options)
}
