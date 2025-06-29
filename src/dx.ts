import {Readable} from 'node:stream'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {AsyncLocalStorage} from 'node:async_hooks'
import {type DxContext, writeRes} from './dxHelpers.ts'
import type {SendOptions} from './staticHelpers.ts'

export interface Chainable<
	P extends any[] = any[],
	R = any,
	Next = (...np: any[]) => any,
> {
	(next: Next, ...p: P): R
}

export interface Context<
	T,
	Params extends any[],
	R = any,
	Next = (...np: any[]) => any,
> {
	value: Awaited<T> // can be undefined
	get(req: IncomingMessage): T
	set(req: IncomingMessage, value: T): void
	(...params: Params): Promise<T>
	chain(...params: Params): Chainable<Params, R, Next>
}
export function makeDxContext<
	T,
	Params extends any[],
	R = any,
	Next = (...np: any[]) => any,
>(maker: (...params: Params) => T | Promise<T>): Context<T, Params, R, Next> {
	const promiseMap = new WeakMap<IncomingMessage, Promise<T>>()
	const valueMap = new WeakMap<IncomingMessage, T>()
	const context: Context<T, Params, R, Next> = (...params: Params) => {
		const req = getReq()
		if (!promiseMap.has(req)) promiseMap.set(req, (async () => {
			const value = await maker(...params)
			valueMap.set(req, value)
			return value
		})())
		return promiseMap.get(req)
	}
	Object.defineProperty(context, 'value', {
		get() {return valueMap.get(getReq())},
		set(value) {
			const req = getReq()
			promiseMap.set(req, Promise.resolve(value))
			valueMap.set(req, value)
		}
	})
	context.chain = (...params) => async next => {
		await context(...params)
		return next()
	}
	context.set = (req, value) => {
		promiseMap.set(req, Promise.resolve(value))
		valueMap.set(req, value)
	}
	context.get = req => valueMap.get(req)
	return context
}

const requestStorage = new AsyncLocalStorage<{
	req: IncomingMessage
	res: ServerResponse
}>()
const dxContext = makeDxContext<DxContext>(options => ({...options}))
export function dxServer(
	req: IncomingMessage,
	res: ServerResponse,
	options: {
		jsonBeautify?: boolean
		disableEtag?: boolean
	} = {}
): Chainable {
	return async next => {
		dxContext.set(req, {...options})
		const result = await requestStorage.run({req, res}, next)
		await writeRes(req, res, dxContext.get(req))
		return result
	}
}

// method: verb
// url: full url without server, protocol, port.
// headers: if headers are repeated, they are joined by comma. Header names are lowercased.
// rawHeaders: list of header name and value in a flat array. Case is preserved.
export function getReq(): IncomingMessage {return requestStorage.getStore()!.req}
export function getRes(): ServerResponse {return requestStorage.getStore()!.res}

export function setText(text: string, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxContext.value
	if (status) res.statusCode = status
	dx.data = text
	dx.type = 'text'
}

export function setEmpty({status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxContext.value
	if (status) res.statusCode = status
	dx.data = undefined
	dx.type = 'empty'
}

export function setHtml(html: string, opts: { status?: number } = {}) {
	setText(html, opts)
	const dx = dxContext.value
	dx.type = 'html'
}

export function setFile(filePath: string, options?: SendOptions) {
	const dx = dxContext.value
	dx.data = filePath
	dx.type = 'file'
	dx.options = options
}

export function setBuffer(buffer: Buffer, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxContext.value
	if (status) res.statusCode = status
	dx.data = buffer
	dx.type = 'buffer'
}

export function setNodeStream(stream: Readable, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxContext.value
	if (status) res.statusCode = status
	dx.data = stream
	dx.type = 'nodeStream'
}

export function setWebStream(stream: ReadableStream, {status}: { status?: number } = {}) {
	const res = getRes()
	const dx = dxContext.value
	if (status) res.statusCode = status
	dx.data = stream
	dx.type = 'webStream'
}

export function setJson(json: any, {status}: { status?: number } = {}) {
	const res = getRes()
	if (status) res.statusCode = status

	const dx = dxContext.value
	dx.data = json
	dx.type = 'json'
}

export function setRedirect(url: string, status: 301 | 302) {
	const res = getRes()
	const dx = dxContext.value
	res.statusCode = status
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

