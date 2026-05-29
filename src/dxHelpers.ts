import {STATUS_CODES, type IncomingMessage, type ServerResponse} from 'node:http'
import {Readable} from 'node:stream'
import type {ReadableStream as WebReadableStream} from 'node:stream/web'
import {pipeline} from 'node:stream/promises'
import {entityTag, isFreshETag} from './vendors/etag.js'
import {sendFileTrusted, type SendFileOptions, type HttpError} from './staticHelpers.js'

export type DxContext = {
	jsonBeautify?: boolean // json only
	disableEtag?: boolean
} & (
	| {
			type: 'empty'
			data: undefined
			options: undefined
	  }
	| {
			type: 'text'
			data: string
			options: undefined
	  }
	| {
			type: 'html'
			data: string
			options: undefined
	  }
	| {
			type: 'buffer'
			data: Buffer
			options: undefined
	  }
	| {
			type: 'json'
			data: any
			options: undefined
	  }
	| {
			type: 'redirect'
			data: string
			options: undefined
	  }
	| {
			type: 'nodeStream'
			data: Readable
			options: undefined
	  }
	| {
			type: 'webStream'
			data: WebReadableStream
			options: undefined
	  }
	| {
			type: 'file'
			data: string
			options?: SendFileOptions
	  }
)

// writeRes runs after the user's handler, outside any try/catch the caller controls, so it must
// NEVER throw or reject: a synchronous throw would crash the request and an unhandled rejection could
// take down the process. Most failures originate from the handler's own input — a cyclic or BigInt
// json body, a non-string text body, a header-invalid redirect URL, a torn-down socket — so rather
// than guard each statement, flushRes runs inside one global catch that logs with the [dx-server]
// tag, answers with the error's HTTP status (or 500), and tears the socket down. Every statement in
// flushRes that can throw is marked with a `throws:` comment — including the streaming helpers,
// whose failures (404/403/416 from sendFileTrusted) now flow to the same global catch.
export async function writeRes(req: IncomingMessage, res: ServerResponse, dx: DxContext) {
	try {
		await flushRes(req, res, dx)
	} catch (e) {
		console.error('[dx-server]', e)
		// answer while the response is still uncommitted, honoring any HTTP status the error carries
		// (e.g. sendFileTrusted's 403/404/416), otherwise 500. the inner try keeps this handler from
		// faulting again. always "production": the real error is logged, never leaked — the body is just
		// the status text.
		if (!res.headersSent)
			try {
				const status = (e as Partial<HttpError>)?.statusCode ?? 500
				res.statusCode = status
				res.setHeader('Content-Type', 'text/html')
				res.end(req.method === 'HEAD' ? undefined : STATUS_CODES[status] ?? STATUS_CODES[500])
			} catch (e2) {
				console.error('[dx-server]', e2)
			}
		await awaitResFinished(res)
		// after an internal error a half-written or keep-alive socket may be inconsistent — tear it down
		if (!res.destroyed) res.destroy()
	}
}

async function flushRes(
	req: IncomingMessage,
	res: ServerResponse,
	{type, data, jsonBeautify, disableEtag, options}: DxContext,
) {
	if (res.headersSent) return

	let buffer: Buffer | undefined

	switch (type) {
		case 'text':
		case 'html':
			setContentType(type === 'html' ? 'text/html' : 'text/plain')
			buffer = Buffer.from(data ?? '') // throws: a non-string body slipped past the types
			break
		case 'buffer':
			setContentType('application/octet-stream')
			buffer = data ?? Buffer.from('')
			break
		case 'json':
			setContentType('application/json')
			buffer =
				data === undefined
					? Buffer.from('')
					: // throws: JSON.stringify on a circular reference, a BigInt, or a throwing toJSON()
						Buffer.from(jsonBeautify ? JSON.stringify(data, null, 2) : JSON.stringify(data))
			break
		case 'redirect':
			res.setHeader('location', data) // throws: a header-invalid URL (CR/LF, non-latin1)
			buffer = Buffer.from('')
			break
		case 'empty':
			buffer = Buffer.from('')
			break
		// Streaming paths own res.end() themselves (via pipeline/sendFileTrusted) and must be
		// awaited so the chain resolves only after the flush.
		case 'nodeStream':
		case 'webStream':
			if (!data) {
				buffer = Buffer.from('')
				break
			}
		// falls through — a non-empty stream shares the streaming block below
		case 'file':
			// streams have no intrinsic type, so default them to octet-stream. files do NOT get a
			// default here: sendFileTrusted derives Content-Type from the file extension (and falls
			// back to octet-stream itself). pre-setting it would suppress that extension detection.
			if (type !== 'file') setContentType('application/octet-stream')
			// throws/rejects -> the global catch: a pre-header failure (missing file 404, EACCES 403,
			// bad range 416) is answered with that status, a mid-stream failure tears the already-
			// committed socket down.
			if (type === 'file') await sendFileTrusted(req, res, data, options)
			else if (type === 'nodeStream') await pipeline(data, res)
			else if (type === 'webStream') await pipeline(Readable.fromWeb(data), res)
			await awaitResFinished(res)
			return
		case undefined:
			// No setter was called. End the response with 404 instead of leaving it hung.
			if (!res.headersSent) res.statusCode = 404
			res.end() // throws: torn-down socket -> rethrown to the global catch
			await awaitResFinished(res)
			return
		default:
			// unreachable through the typed API; if hit, let the global catch turn it into a 500
			throw new Error(`unsupported response type ${type satisfies never}`)
	}

	// 204 No Content and 304 Not Modified must not carry a body or Content-Length. These header writes
	// cannot throw: the values are a number and a hash token, written while headersSent is still false.
	if (res.statusCode !== 204 && res.statusCode !== 304) {
		// Content-Length and ETag mirror what a GET would send, so a HEAD reports them too.
		res.setHeader('content-length', buffer.length)
		// no ETag for redirects: the empty body would share the empty-body tag with other empty
		// responses, so a cached If-None-Match could wrongly 304 a redirect (dropping Location)
		if (!disableEtag && type !== 'redirect') {
			const etag = entityTag(buffer)
			res.setHeader('ETag', etag)
			if (isFreshETag(req, etag)) res.statusCode = 304
		}
	}

	// 204/304 carry no body or representation/framing metadata (ETag is a validator, so it stays).
	// This catches both an explicitly-set 204/304 and the freshETag -> 304 transition above.
	if (res.statusCode === 204 || res.statusCode === 304) {
		// https://github.com/expressjs/express/blob/980d881e3b023db079de60477a2588a91f046ca5/lib/response.js#L210
		res.removeHeader('content-type')
		res.removeHeader('content-length')
		res.removeHeader('transfer-encoding')
	} else if (req.method !== 'HEAD') res.write(buffer) // throws: torn-down socket -> the global catch
	// we do not support content-encoding (gzip, deflate, br) and leave it to reverse proxy or CDN
	res.end() // throws: torn-down socket -> the global catch
	await awaitResFinished(res)

	function setContentType(contentType: string) {
		if (res.headersSent || res.getHeader('content-type')) return
		// text/* defaults to utf-8; other types (json, octet-stream) carry no charset. To use a
		// different charset, set the content-type header yourself via res.setHeader().
		res.setHeader('content-type', contentType.startsWith('text/') ? `${contentType}; charset=utf-8` : contentType)
	}
}

// Resolves when res is fully flushed (finish) or the socket is gone (close).
// Used as the universal "we're done with this response" signal so every code path
// in writeRes can guarantee the chain doesn't unwind before bytes hit the wire.
function awaitResFinished(res: ServerResponse) {
	if (res.writableFinished || res.destroyed) return Promise.resolve()
	return new Promise<void>(resolve => {
		res.once('finish', done)
		res.once('close', done)
		// a flush error still means "we're done" — resolve (and absorb the error) so the chain neither
		// hangs nor crashes on an otherwise-unhandled 'error' event.
		res.once('error', done)
		function done() {
			res.off('finish', done)
			res.off('close', done)
			res.off('error', done)
			resolve()
		}
	})
}
