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

export interface Context<
	T,
	Params extends any[],
	R = any,
	Next = (...np: any[]) => any,
> {
	value: Awaited<T> // can be undefined
	chain(...params: Params): Chainable<Params, R, Next>
	(...params: Params): Promise<T>
}
export function makeDxContext<
	T,
	Params extends any[],
	R = any,
	Next = (...np: any[]) => any,
>(maker: (...params: Params) => T): Context<T, Params, R, Next> {
	const promiseSymbol = Symbol('promise')
	const valueSymbol = Symbol('value')
	// wrap in an async function to ensure the maker is called only once
	const context: Context<T, Params, R, Next> = (...params: Params) => getReq()[promiseSymbol] ??= (async () => {
		try {
			return getReq()[valueSymbol] = await maker(...params)
		} catch (e) {
			throw e
		}
	})()
	Object.defineProperty(context, 'value', {
		get() {
			if (!getReq()[promiseSymbol]) throw new Error('value is not ready')
			return getReq()[valueSymbol]
		}
	})
	context.chain = (...params) => async next => {
		await context(...params)
		return next()
	}
	return context
}
