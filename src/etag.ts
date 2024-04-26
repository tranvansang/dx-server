// etag: https://github.com/jshttp/etag/blob/b9f0642256e63654287299d205bc6ced71b1a228/index.js#L39
import crypto from 'node:crypto'
import type {IncomingMessage} from 'node:http'

export function entityTag(buf: Buffer, weak?: boolean) {
	// pre-computed empty
	return buf.length
		? `${buf.length.toString(16)}-${crypto
			.createHash('sha1')
			.update(buf)
			.digest('base64')
			.substring(0, 27)}"`
		: `${weak ? 'W/' : ''}"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"`
	// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag#directives
	// weak W/ vs strong eTag
	// same weak eTag: 2 resources might be semantically equivalent, but not byte-for-byte identical
}

const CACHE_CONTROL_NO_CACHE_REGEXP = /(?:^|,)\s*?no-cache\s*?(?:,|$)/
export function statTag(stat) {
	const mtime = stat.mtime.getTime().toString(16)
	const size = stat.size.toString(16)

	return `"${size}-${mtime}"`
}
// https://github.com/jshttp/fresh/blob/05254186fd7428915224db46144fc94293a7df7d/index.js#L33
export function isFreshETag(req: IncomingMessage, etag: string) {
	const noneMatch = req.headers['if-none-match']
	if (!noneMatch) return

	// Always return stale when Cache-Control: no-cache
	// to support end-to-end reload requests
	// https://tools.ietf.org/html/rfc2616#section-14.9.4
	const cacheControl = req.headers['cache-control']
	if (cacheControl && CACHE_CONTROL_NO_CACHE_REGEXP.test(cacheControl)) return

	if (noneMatch && noneMatch !== '*') {
		if (!etag) return

		let etagStale = true
		for (const match of parseTokenList(noneMatch)) {
			if (match === etag || match === `W/${etag}` || `W/${match}` === etag) {
				etagStale = false
				break
			}
		}
		if (etagStale) return
	}

	return true
}

export function isFreshModifiedSince(req: IncomingMessage, lastModified: string) {
	const modifiedSince = req.headers['if-modified-since']
	if (!modifiedSince) return

	// Always return stale when Cache-Control: no-cache
	// to support end-to-end reload requests
	// https://tools.ietf.org/html/rfc2616#section-14.9.4
	const cacheControl = req.headers['cache-control']
	if (cacheControl && CACHE_CONTROL_NO_CACHE_REGEXP.test(cacheControl)) return

	if (modifiedSince && lastModified) {
		const lastModifiedDate = Date.parse(lastModified)
		const modifiedSinceDate = Date.parse(modifiedSince)
		return !isNaN(lastModifiedDate) && !isNaN(modifiedSinceDate) && lastModifiedDate <= modifiedSinceDate
	}
	return true
}

function parseTokenList (str: string) {
	let end = 0
	const list = []
	let start = 0

	// gather tokens
	for (let i = 0, len = str.length; i < len; i++) {
		switch (str.charCodeAt(i)) {
			case 0x20: /*   */
				if (start === end) {
					start = end = i + 1
				}
				break
			case 0x2c: /* , */
				list.push(str.substring(start, end))
				start = end = i + 1
				break
			default:
				end = i + 1
				break
		}
	}
	// final token
	list.push(str.substring(start, end))
	return list
}
