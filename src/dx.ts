import {Readable} from 'node:stream'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {AsyncLocalStorage} from 'node:async_hooks'
import {type DxContext, writeRes} from './dxHelpers.js'
import {SendOptions} from 'send'

export interface Chainable<
	P extends any[] = any[],
	R = any,
	Next = (...np: any[]) => any,
> {
	(next: Next, ...p: P): R
}

const reqStorage = new AsyncLocalStorage<IncomingMessage>()
const resStorage = new AsyncLocalStorage<ServerResponse>()
const dxStorage = new AsyncLocalStorage<DxContext>()
export function dxServer(
	req: IncomingMessage,
	res: ServerResponse,
	options: {
		jsonBeautify?: boolean
		disableEtag?: boolean
	} = {}
): Chainable {
	return async next => {
		const dx: DxContext = {...options}
		const result = await dxStorage.run(
			dx,
			() => reqStorage.run(
				req,
				() => resStorage.run(res, next)
			)
		)
		await writeRes(req, res, dx)
		return result
	}
}

// method: verb
// url: full url without server, protocol, port.
// headers: if headers are repeated, they are joined by comma. Header names are lowercased.
// rawHeaders: list of header name and value in a flat array. Case is preserved.
export function getReq(): IncomingMessage {
	return reqStorage.getStore()!
}
export function getRes(): ServerResponse {
	return resStorage.getStore()!
}

// todo: support setFile (with stream or with buffer)

export function setText(text: string, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxStorage.getStore()!
	if (status) res.statusCode = status
	dx.data = text
	dx.type = 'text'
}

export function setHtml(html: string, opts: { status?: number } = {}) {
	setText(html, opts)
	const dx = dxStorage.getStore()!
	dx.type = 'html'
}

export function setFile(filePath: string, options?: SendOptions) {
	const dx = dxStorage.getStore()!
	dx.data = filePath
	dx.type = 'file'
	dx.options = options
}

export function setBuffer(buffer: Buffer, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxStorage.getStore()!
	if (status) res.statusCode = status
	dx.data = buffer
	dx.type = 'buffer'
}

export function setNodeStream(stream: Readable, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxStorage.getStore()!
	if (status) res.statusCode = status
	dx.data = stream
	dx.type = 'nodeStream'
}

export function setWebStream(stream: ReadableStream, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxStorage.getStore()!
	if (status) res.statusCode = status
	dx.data = stream
	dx.type = 'webStream'
}

export function setJson(json: any, {status}: { status?: number } = {}) {
	const res = getRes()
	if (status) res.statusCode = status

	const dx = dxStorage.getStore()!
	dx.data = json
	dx.type = 'json'
}

export function setRedirect(url: string, status: 301 | 302) {
	const res = getRes()
	const dx = dxStorage.getStore()!
	res.statusCode = status
	dx.data = url
	dx.type = 'redirect'
}

// todo setDownload
