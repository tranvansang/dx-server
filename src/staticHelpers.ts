import {IncomingMessage, ServerResponse} from 'node:http'
import './polyfillWithResolvers.js'
import {setEmpty, setHtml, setNodeStream} from './dx.js'
import path from 'node:path'
import {stat} from 'node:fs/promises'
import {statTag} from './vendors/etag.js'
import {contentTypeForExtension} from './vendors/mime.js'
import {fresh, parseHttpDate, parseTokenList} from './vendors/fresh.js'
import {parseRange} from './vendors/rangeParser.js'
import {createReadStream} from 'node:fs'
import { onFinished } from './vendors/onFinished.js'

const UP_PATH_REGEXP = /(?:^|[\\/])\.\.(?:[\\/]|$)/
const BYTES_RANGE_REGEXP = /^ *bytes=/

export interface SendOptions {
	disableAcceptRanges?: boolean
	disableLastModified?: boolean
	disableEtag?: boolean

	disableCacheControl?: boolean
	maxAge?: number // in milliseconds

	dotfiles?: 'allow' | 'deny' | 'ignore' // default: 'ignore'

	immutable?: boolean

	end?: number
	// extensions?: string[] | string | boolean // disable extensions option
	// index?: string[] | string | boolean // disable index option
	root?: string
	start?: number
}

export async function sendFile(
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string, // plain path, not URI-encoded
	{
		root, dotfiles, start = 0, end,
		disableAcceptRanges, disableLastModified, disableEtag,
		disableCacheControl, maxAge = 60 * 60 * 24 * 365 * 1000, // 1 year
		immutable,
	}: SendOptions | undefined = {},
) {
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
	if (parts.some(part => part[0] === '.')) switch (dotfiles) {
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

	const fileStat = await stat(pathname)
	// not found, check extensions
	// if (err.code === 'ENOENT' && !path.extname(pathname) && !pathEndsWithSep) throw err
	// switch (err.code) {
	// 	case 'ENAMETOOLONG':
	// 	case 'ENOENT':
	// 	case 'ENOTDIR':
	// 	default:
	// }

	if (fileStat.isDirectory()) throw new Error('Forbidden: directory access is not allowed')

	// do send
	const opts = {}

	if (res.headersSent) return

	// #region set header fields

	if (!disableAcceptRanges && !res.getHeader('Accept-Ranges')) res.setHeader('Accept-Ranges', 'bytes')

	if (!disableCacheControl && !res.getHeader('Cache-Control')) res.setHeader('Cache-Control', [`public, max-age=${Math.floor(maxAge / 1000)}`,
		immutable && 'immutable',
	].filter(Boolean).join(', '))

	if (!disableLastModified && !res.getHeader('Last-Modified')) res.setHeader('Last-Modified', fileStat.mtime.toUTCString())

	if (!disableEtag && !res.getHeader('ETag')) res.setHeader('ETag', statTag(fileStat))
	// #endregion

	// content-type
	if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', contentTypeForExtension(path.extname(pathname)) || 'application/octet-stream')

	// conditional GET support
	// isConditionalGET
	if (req.headers['if-match'] || req.headers['if-unmodified-since'] || req.headers['if-none-match'] || req.headers['if-modified-since']) {
		// #region isPreconditionFailure
		// if-match
		const match = req.headers['if-match']
		if (match) {
			const etag = res.getHeader('ETag')
			if (
				!etag
				|| (match !== '*' && parseTokenList(match).every(match => match !== etag && match !== 'W/' + etag && 'W/' + match !== etag))
			) throw new Error('Precondition Failed: request headers do not match the response')
		}

		// if-unmodified-since
		const unmodifiedSince = parseHttpDate(req.headers['if-unmodified-since'])
		if (!isNaN(unmodifiedSince)) {
			const lastModified = parseHttpDate(res.getHeader('Last-Modified'))
			if (isNaN(lastModified) || lastModified > unmodifiedSince) throw new Error('Precondition Failed: resource has been modified since the specified date')
		}
		// #endregion

		// isCachable
		if (
			((res.statusCode >= 200 && res.statusCode < 300) ||
				res.statusCode === 304)
			&& fresh(req.headers, {
				etag: res.getHeader('ETag'),
				'last-modified': res.getHeader('Last-Modified')
			})
		) {
			// removeContentHeaderFields
			res.removeHeader('Content-Encoding')
			res.removeHeader('Content-Language')
			res.removeHeader('Content-Length')
			res.removeHeader('Content-Range')
			res.removeHeader('Content-Type')
			return setEmpty({status: 304})
		}
	}

	// adjust len to start/end options
	let len = fileStat.size
	len = Math.max(0, len - start)
	if (end !== undefined) {
		const bytes = end - start + 1
		if (len > bytes) len = bytes
	}

	// Range support
	let ranges = req.headers.range
	if (!disableAcceptRanges && BYTES_RANGE_REGEXP.test(ranges)) {
		// parse
		ranges = parseRange(len, ranges, {combine: true})

		// If-Range support
		if (!isRangeFresh(req, res)) ranges = -2

		// unsatisfiable
		if (ranges === -1) {
			// Content-Range
			res.setHeader('Content-Range', contentRange('bytes', len))

			// 416 Requested Range Not Satisfiable
			throw new Error('Requested Range Not Satisfiable: requested range is not satisfiable')
			// return this.error(416, {
			// 	headers: {'Content-Range': res.getHeader('Content-Range')}
			// })
		}

		// valid (syntactically invalid/multiple ranges are treated as a regular response)
		if (ranges !== -2 && ranges.length === 1) {
			// Content-Range
			res.statusCode = 206
			res.setHeader('Content-Range', contentRange('bytes', len, ranges[0]))

			// adjust for requested range
			start += ranges[0].start
			len = ranges[0].end - ranges[0].start + 1
		}
	}

	// set read options
	end = Math.max(start, start + len - 1)

	// content-length
	res.setHeader('Content-Length', len)

	// HEAD support
	if (req.method === 'HEAD') return setEmpty()

	// do stream

	const stream = createReadStream(pathname, {start, end})
	setNodeStream(stream)

	const defer = Promise.withResolvers<void>()

	onFinished(res, cleanup)
	stream.on('error', err => {
		cleanup()
		defer.reject(err)
	})
	stream.on('end', () => defer.resolve())
	function cleanup () {
		stream.destroy()
	}

	return defer.promise
}

function isRangeFresh (req: IncomingMessage, res: ServerResponse) {
	const ifRange = req.headers['if-range']

	if (!ifRange) return true

	// if-range as etag
	if (ifRange.indexOf('"') !== -1) {
		const etag = res.getHeader('ETag')
		return etag && ifRange.includes(etag)
	}

	// if-range as modified date
	const lastModified = res.getHeader('Last-Modified')
	return parseHttpDate(lastModified) <= parseHttpDate(ifRange)
}

function contentRange (type, size, range) {
	return `${type} ${range ? range.start + '-' + range.end : '*'}/${size}`
}
