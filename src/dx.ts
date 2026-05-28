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
		charset?: BufferEncoding
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

// options common to every setter. charset and disableEtag are written onto the dx context and
// consumed by writeRes; note charset/disableEtag only affect buffer-backed responses
// (text/html/json/buffer/empty) — streams, files and redirects bypass that code path in writeRes.
export interface ResponseOptions {
	status?: number
	charset?: BufferEncoding
	disableEtag?: boolean
}

function applyResponseOptions({status, charset, disableEtag}: ResponseOptions = {}) {
	const dx = dxContext.value
	if (status) getRes().statusCode = status
	if (charset !== undefined) dx.charset = charset
	if (disableEtag !== undefined) dx.disableEtag = disableEtag
	return dx
}

export function setText(text: string, options: ResponseOptions = {}) {
	const dx = applyResponseOptions(options)
	dx.data = text
	dx.type = 'text'
}

export function setEmpty(options: ResponseOptions = {}) {
	const dx = applyResponseOptions(options)
	dx.data = undefined
	dx.type = 'empty'
}

export function setHtml(html: string, options: ResponseOptions = {}) {
	setText(html, options)
	dxContext.value.type = 'html'
}

export function setFile(filePath: string, {status, disableEtag, ...options}: SendFileOptions & ResponseOptions = {}) {
	// charset stays in `options` (SendFileOptions): for files the Content-Type is owned by
	// sendFileTrusted, so charset must reach it there rather than the (inert-for-files) dx.charset.
	const dx = applyResponseOptions({status, disableEtag})
	dx.data = filePath
	dx.type = 'file'
	dx.options = options
}

export function setBuffer(buffer: Buffer, options: ResponseOptions = {}) {
	const dx = applyResponseOptions(options)
	dx.data = buffer
	dx.type = 'buffer'
}

export function setNodeStream(stream: Readable, options: ResponseOptions = {}) {
	const dx = applyResponseOptions(options)
	dx.data = stream
	dx.type = 'nodeStream'
}

export function setWebStream(stream: ReadableStream, options: ResponseOptions = {}) {
	const dx = applyResponseOptions(options)
	dx.data = stream
	dx.type = 'webStream'
}

export function setJson(json: any, options: ResponseOptions = {}) {
	const dx = applyResponseOptions(options)
	dx.data = json
	dx.type = 'json'
}

export function setRedirect(url: string, status: 301 | 302, options: Omit<ResponseOptions, 'status'> = {}) {
	const dx = applyResponseOptions({...options, status})
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
