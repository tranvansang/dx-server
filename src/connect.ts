import type {IncomingMessage, ServerResponse} from 'node:http'
import {type Chainable, getReq, getRes} from './dx.ts'
import './polyfillWithResolvers.ts'

// support async middleware
// do not support error middleware (the one with 4 arguments)
export function connectMiddlewares(
	...middlewares: Array<(req: IncomingMessage, res: ServerResponse, next: () => any) => any>
): Chainable {
	return next => {
		const req = getReq()
		const res = getRes()
		const defer = Promise.withResolvers()
		// because middleware usually not return next() or await to next(),
		// the next passed to the middleware must be resilient to error (never throw or reject)
		middlewares.reduceRight(
			(connectNext, middleware) => async (error?: any) => {
				// this function must not throw or reject
				if (error !== undefined && error !== null) return defer.reject(error)
				try {return await middleware(req, res, connectNext)}
				catch (err) {return defer.reject(err)}
			},
			async () => {
				// next might throw error synchronously and be swallowed by some async middleware unless we wrap it here
				try {
					return defer.resolve(await next())
				} catch (err) {
					return defer.reject(err)
				}
			}
		)() // no need to await result from this call because it will never reject
		return defer.promise
		// let i = 0
		// const run = async () => {
		// 	if (i === middlewares.length) return next()
		// 	await middlewares[i++](req, res, run)
		// }
		// await run()
	}
}
