import {IncomingMessage, ServerResponse} from 'node:http'
import path from 'node:path'
import {open, realpath} from 'node:fs/promises'
import {entityTagPath, statTag} from './vendors/etag.js'
import {contentTypeForExtension} from './vendors/mime.js'
import {fresh, parseHttpDate, parseTokenList} from './vendors/fresh.js'
import {parseRange} from './vendors/rangeParser.js'
import {promisify} from 'node:util'
import {pipeline} from 'node:stream/promises'

export type HttpError = Error & {statusCode: number}
function httpError(message: string, statusCode: number) {
	const e = new Error(message) as HttpError
	e.statusCode = statusCode
	return e
}

const bytesRangeRegexp = /^ *bytes=/
const upPathRegexp = /(?:^|[\\/])\.\.(?:[\\/]|$)/

export interface SendFileOptions {
	allowDotfiles?: boolean
	// extensions?: string[] | string | boolean // disable extensions option
	// index?: string[] | string | boolean // disable index option
	root?: string
	disableAcceptRanges?: boolean
	disableLastModified?: boolean
	// use weak mtime-based etag instead of strong content-based etag (enables streaming and range requests)
	// service like GAE reset mtime to Tue, 01 Jan 1980 00:00:01 GMT (Unix timestamp 315532801), so we enable strong tag by default
	etag?: 'disabled' | 'strong' | 'weak'

	disableCacheControl?: boolean
	maxAge?: number // in milliseconds
	immutable?: boolean

	// when root is set, set true to 403 any file whose real path resolves outside root
	// (symlink containment). default: symlinks are followed.
	disableFollowSymlinks?: boolean

	end?: number
	start?: number
}

export async function sendFileTrusted(
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string, // plain path, not URI-encoded
	{
		root,
		allowDotfiles,
		start = 0,
		end,
		disableAcceptRanges,
		disableLastModified,
		etag = 'weak',
		disableCacheControl,
		maxAge = 60 * 60 * 24 * 365 * 1000, // 1 year
		immutable,
		disableFollowSymlinks,
	}: SendFileOptions = {},
) {
	// null byte(s)
	if (pathname.includes('\0')) throw httpError('Forbidden', 403)

	let parts: string[]
	if (root) {
		// normalize
		pathname = path.normalize(`.${path.sep}${pathname}`)

		// malicious path
		if (upPathRegexp.test(pathname)) throw httpError('Forbidden', 403)

		// explode path parts
		parts = pathname.split(path.sep)

		// join / normalize from optional root dir
		pathname = path.normalize(path.join(root, pathname))
	} else {
		// malicious path
		if (upPathRegexp.test(pathname)) throw httpError('Forbidden', 403)

		// explode path parts
		parts = path.normalize(pathname).split(path.sep)

		// join / normalize from optional root dir
		pathname = path.resolve(pathname)
	}

	// dotfile handling
	if (parts.some(part => part.length > 1 && part[0] === '.') && !allowDotfiles)
		throw httpError('Forbidden: dotfiles are not allowed', 403)

	// pathEndsWithSep
	if (pathname[pathname.length - 1] === path.sep) throw httpError('Forbidden: directory access is not allowed', 403)

	// Open the file up front. Doing this before any header is set means a missing file or a
	// read-permission error (EACCES) is turned into a clean HTTP status while res is still
	// uncommitted — instead of setting Content-Length/ETag and then having the read fail, which
	// would either reset the connection or leave the client waiting for a body that never comes.
	let handle
	try {
		handle = await open(pathname, 'r')
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code
		if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG') throw httpError('Not Found', 404)
		if (code === 'EACCES' || code === 'EPERM') throw httpError('Forbidden', 403)
		if (code === 'EISDIR') throw httpError('Forbidden: directory access is not allowed', 403)
		throw e
	}

	try {
		const fileStat = await handle.stat()

		if (fileStat.isDirectory()) throw httpError('Forbidden: directory access is not allowed', 403)

		// symlink containment: ensure the real target stays inside root (opt-in)
		if (root && disableFollowSymlinks) {
			const [realFile, realRoot] = await Promise.all([realpath(pathname), realpath(root)])
			const rel = path.relative(realRoot, realFile)
			if (rel.startsWith('..') || path.isAbsolute(rel))
				throw httpError('Forbidden: symlink escapes root', 403)
		}

		if (res.headersSent) return

		//region set header fields

		if (!disableAcceptRanges && !res.getHeader('Accept-Ranges')) res.setHeader('Accept-Ranges', 'bytes')

		if (!disableCacheControl && !res.getHeader('Cache-Control'))
			res.setHeader(
				'Cache-Control',
				[`public, max-age=${Math.floor(maxAge / 1000)}`, immutable && 'immutable'].filter(Boolean).join(', '),
			)

		if (!disableLastModified && !res.getHeader('Last-Modified'))
			res.setHeader('Last-Modified', fileStat.mtime.toUTCString())

		if (etag !== 'disabled' && !res.getHeader('ETag'))
			res.setHeader('ETag', etag === 'weak' ? statTag(fileStat) : await entityTagPath(fileStat, pathname))
		//endregion set header fields

		// content-type
		if (!res.getHeader('Content-Type'))
			res.setHeader(
				'Content-Type',
				contentTypeForExtension(path.extname(pathname).slice(1)) || 'application/octet-stream',
			)

		// conditional GET support
		// isConditionalGET
		if (
			req.headers['if-match'] ||
			req.headers['if-unmodified-since'] ||
			req.headers['if-none-match'] ||
			req.headers['if-modified-since']
		) {
			//region isPreconditionFailure
			// if-match
			const match = req.headers['if-match']
			if (match) {
				const etag = res.getHeader('ETag')
				if (
					!etag ||
					(match !== '*' &&
						parseTokenList(match).every(
							match => match !== etag && match !== 'W/' + etag && 'W/' + match !== etag,
						))
				)
					throw httpError('Precondition Failed: request headers do not match the response', 412)
			}

			// if-unmodified-since (ignore when using strong etag since mtime may be unreliable)
			if (etag === 'weak') {
				const unmodifiedSince = parseHttpDate(req.headers['if-unmodified-since'])
				if (!isNaN(unmodifiedSince)) {
					const lastModified = parseHttpDate(res.getHeader('Last-Modified'))
					if (isNaN(lastModified) || lastModified > unmodifiedSince)
						throw httpError('Precondition Failed: resource has been modified since the specified date', 412)
				}
			}
			//endregion isPreconditionFailure

			// isCachable
			if (
				((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 304) &&
				fresh(req.headers, {
					etag: res.getHeader('ETag'),
					// Only use last-modified for freshness check when using weak Etag
					'last-modified': etag === 'weak' ? res.getHeader('Last-Modified') : undefined,
				})
			) {
				// removeContentHeaderFields
				res.removeHeader('Content-Encoding')
				res.removeHeader('Content-Language')
				res.removeHeader('Content-Length')
				res.removeHeader('Content-Range')
				res.removeHeader('Content-Type')
				res.statusCode = 304
				return void (await promisify(res.end.bind(res))())
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
		if (!disableAcceptRanges && bytesRangeRegexp.test(ranges ?? '')) {
			// parse
			let rangesNum = parseRange(len, ranges, {combine: true})

			// If-Range support
			if (!isRangeFresh(req, res)) rangesNum = -2

			// unsatisfiable
			if (rangesNum === -1) {
				// Content-Range
				res.setHeader('Content-Range', contentRange('bytes', len))

				// 416 Requested Range Not Satisfiable
				throw httpError('Requested Range Not Satisfiable: requested range is not satisfiable', 416)
				// return this.error(416, {
				// 	headers: {'Content-Range': res.getHeader('Content-Range')}
				// })
			}

			// valid (syntactically invalid/multiple ranges are treated as a regular response)
			if (rangesNum !== -2 && rangesNum.length === 1) {
				// Content-Range
				res.statusCode = 206
				res.setHeader('Content-Range', contentRange('bytes', len, rangesNum[0]))

				// adjust for requested range
				start += rangesNum[0].start
				len = rangesNum[0].end - rangesNum[0].start + 1
			}
		}

		// set read options
		end = Math.max(start, start + len - 1)

		// content-length
		res.setHeader('Content-Length', len)

		// HEAD support
		if (req.method === 'HEAD') return void (await promisify(res.end.bind(res))())

		// stream file: pipeline awaits res 'finish' (full flush) and destroys the source on error
		await pipeline(handle.createReadStream({start, end}), res)
	} finally {
		await handle.close().catch(() => {})
	}
}

function isRangeFresh(req: IncomingMessage, res: ServerResponse) {
	const ifRange = req.headers['if-range']

	if (!ifRange) return true

	// if-range as etag (exact match: If-Range carries a single validator, not a list — a substring
	// test would let If-Range: "ab" match an ETag of "abc")
	if (ifRange.indexOf('"') !== -1) {
		const etag = res.getHeader('ETag')
		return etag !== undefined && ifRange === etag
	}

	// if-range as modified date
	const lastModified = res.getHeader('Last-Modified')
	return parseHttpDate(lastModified) <= parseHttpDate(ifRange)
}

function contentRange(type: string, size: number, range?: {start: number; end: number}) {
	return `${type} ${range ? range.start + '-' + range.end : '*'}/${size}`
}
