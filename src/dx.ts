import {Readable} from 'node:stream'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {AsyncLocalStorage} from 'node:async_hooks'
import {type DxContext, writeRes} from './dxHelpers.js'
import type {SendFileOptions} from './staticHelpers.js'

export interface Chainable<R = any, Next = (...np: any[]) => any> {
	(next: Next): R
}

export interface Context<T, Params extends any[] = any[], R = any, Next = (...np: any[]) => any> {
	value: Awaited<T> // can be undefined
	get(req: IncomingMessage): T
	set(req: IncomingMessage, value: T): void
	(...params: Params): Promise<T>
	chain(...params: Params): Chainable<R, Next>
}
export function makeDxContext<T, Params extends any[] = any[], R = any, Next = (...np: any[]) => any>(
	maker: (...params: Params) => T | Promise<T>,
): Context<T, Params, R, Next> {
	const promiseMap = new WeakMap<IncomingMessage, Promise<T>>()
	const valueMap = new WeakMap<IncomingMessage, T>()
	const context = ((...params: Params) => {
		const req = getReq()
		if (!promiseMap.has(req))
			promiseMap.set(
				req,
				(async () => {
					const value = await maker(...params)
					valueMap.set(req, value)
					return value
				})(),
			)
		return promiseMap.get(req)!
	}) as Context<T, Params, R, Next>
	Object.defineProperty(context, 'value', {
		get() {
			return valueMap.get(getReq())
		},
		set(value) {
			const req = getReq()
			promiseMap.set(req, Promise.resolve(value))
			valueMap.set(req, value)
		},
	})
	context.chain = ((...params: Params) =>
		async (next: Next) => {
			await context(...params)
			return (next as (...args: any[]) => any)()
		}) as Context<T, Params, R, Next>['chain']
	context.set = (req, value) => {
		promiseMap.set(req, Promise.resolve(value))
		valueMap.set(req, value)
	}
	context.get = req => valueMap.get(req) as T
	return context
}

const requestStorage = new AsyncLocalStorage<{
	req: IncomingMessage
	res: ServerResponse
}>()
const dxContext = makeDxContext<DxContext>(options => ({...options}) as DxContext)
export function dxServer(
	req: IncomingMessage,
	res: ServerResponse,
	options: {
		jsonBeautify?: boolean // json only
		disableEtag?: boolean
	} = {},
): Chainable {
	return async next => {
		dxContext.set(req, {...options} as DxContext)
		const result = await requestStorage.run({req, res}, next)
		await writeRes(req, res, dxContext.get(req))
		return result
	}
}

// method: verb
// url: full url without server, protocol, port.
// headers: if headers are repeated, they are joined by comma. Header names are lowercased.
// rawHeaders: list of header name and value in a flat array. Case is preserved.
export function getReq() {
	return requestStorage.getStore()!.req
}
export function getRes() {
	return requestStorage.getStore()!.res
}

// Each setter inlines only the options its response type honors. There is no charset option: text/*
// responses are labelled charset=utf-8 automatically, and any other charset must be set manually via
// res.setHeader('content-type', ...). The exception is setFile, which takes charset via
// SendFileOptions (its Content-Type is derived from the file extension by sendFileTrusted).
// disableEtag is honored only by the buffer-backed types (text/html/buffer/json/empty); streams and
// redirects are never ETagged, and setFile controls its ETag via SendFileOptions.etag.

export function setText(text: string, {status, disableEtag}: {status?: number; disableEtag?: boolean} = {}) {
	const dx = dxContext.value
	if (status) getRes().statusCode = status
	if (disableEtag !== undefined) dx.disableEtag = disableEtag
	dx.data = text
	dx.type = 'text'
}

export function setHtml(html: string, options: {status?: number; disableEtag?: boolean} = {}) {
	setText(html, options)
	dxContext.value.type = 'html'
}

export function setBuffer(buffer: Buffer, {status, disableEtag}: {status?: number; disableEtag?: boolean} = {}) {
	const dx = dxContext.value
	if (status) getRes().statusCode = status
	if (disableEtag !== undefined) dx.disableEtag = disableEtag
	dx.data = buffer
	dx.type = 'buffer'
}

export function setJson(json: any, {status, disableEtag}: {status?: number; disableEtag?: boolean} = {}) {
	const dx = dxContext.value
	if (status) getRes().statusCode = status
	if (disableEtag !== undefined) dx.disableEtag = disableEtag
	dx.data = json
	dx.type = 'json'
}

export function setEmpty({status, disableEtag}: {status?: number; disableEtag?: boolean} = {}) {
	const dx = dxContext.value
	if (status) getRes().statusCode = status
	if (disableEtag !== undefined) dx.disableEtag = disableEtag
	dx.data = undefined
	dx.type = 'empty'
}

export function setNodeStream(stream: Readable, {status}: {status?: number} = {}) {
	const dx = dxContext.value
	if (status) getRes().statusCode = status
	dx.data = stream
	dx.type = 'nodeStream'
}

export function setWebStream(stream: ReadableStream, {status}: {status?: number} = {}) {
	const dx = dxContext.value
	if (status) getRes().statusCode = status
	dx.data = stream
	dx.type = 'webStream'
}

export function setFile(filePath: string, {status, ...options}: SendFileOptions & {status?: number} = {}) {
	// charset/etag for files come from SendFileOptions (stay in `options`), handled by sendFileTrusted
	const dx = dxContext.value
	if (status) getRes().statusCode = status
	dx.data = filePath
	dx.type = 'file'
	dx.options = options
}

export function setRedirect(url: string, status: 301 | 302) {
	const dx = dxContext.value
	getRes().statusCode = status
	dx.data = url
	dx.type = 'redirect'
}

// for download, set content-disposition header
// res.setHeader('Content-disposition', 'attachment; filename=my-movie.MOV')

// res.setHeader('Content-type', 'video/quicktime')
// fileStream.pipe(res)
// or
// send(req, filePath, options).pipe(res) // which will set content-type, content-length, and other cache related headers like staticHelpers.sendFile

// implementing this require a strict validation for the type (attachment) and filename.
// For example: express relies on this
// https://github.com/jshttp/content-disposition/blob/1037e24e4790273da96645ad250061f39e77968c/index.js#L186
// because in most applications, users can specify a simple filename which usually doesn't need to be validated.
// we leave setDownload() implementation for users, for now.
