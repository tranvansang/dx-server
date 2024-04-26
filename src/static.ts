// @ts-nocheck

import {getReq} from './dx.js'

export function staticMiddleware(
	{root}: {
		root: string
		maxAge?: number // max age in second
	}
) {
	return async (next: () => any) => {
		const req = getReq()
		if (req.method !== 'GET' && req.method !== 'HEAD') return next()

		var forwardError = !fallthrough
		var originalUrl = parseUrl.original(req)
		var path = parseUrl(req).pathname

		// make sure redirect occurs at mount
		if (path === '/' && originalUrl.pathname.substr(-1) !== '/') {
			path = ''
		}

		// create send stream
		var stream = send(req, path, opts)

		// add directory handler
		stream.on('directory', onDirectory)

		// add headers listener
		if (setHeaders) {
			stream.on('headers', setHeaders)
		}

		// add file listener for fallthrough
		if (fallthrough) {
			stream.on('file', function onFile() {
				// once file is determined, always forward error
				forwardError = true
			})
		}

		// forward errors
		stream.on('error', function error(err) {
			if (forwardError || !(err.statusCode < 500)) {
				next(err)
				return
			}

			next()
		})

		// pipe
		stream.pipe(res)
	}
}

/**
 * Collapse all leading slashes into a single slash
 * @private
 */
function collapseLeadingSlashes (str: string) {
	for (let i = 0; i < str.length; i++) {
		if (str.charCodeAt(i) !== 0x2f /* / */) {
			break
		}
	}

	return i > 1
		? '/' + str.slice(i)
		: str
}
