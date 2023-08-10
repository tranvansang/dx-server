import {AsyncLocalStorage} from 'node:async_hooks'
import {Promisable} from 'type-fest'
import {IncomingMessage, ServerResponse} from 'node:http'
import {identity} from 'jmisc'

export const makeContext = <T, Params extends any[] = unknown[]>(
	maker: (...params: Params) => Promisable<T>,
	end: (result: any, value: T) => any = identity,
) => {
	const asyncLocalStorage = new AsyncLocalStorage<T>()
	return {
		get value(): T {
			return asyncLocalStorage.getStore()!
		},
		chain(...params: Params) {
			return async <V>(next: () => V) => {
				const value = await maker(...params)
				return end(await asyncLocalStorage.run(value, next), value)
			}
		},
	}
}

// method: verb
// url: full url without server, protocol, port.
// headers: if headers are repeated, they are joined by comma. Header names are lowercased.
// rawHeaders: list of header name and value in a flat array. Case is preserved.
export const requestContext = makeContext<IncomingMessage, [IncomingMessage]>(identity)
export const responseContext = makeContext<ServerResponse, [ServerResponse]>(identity)

