import express, {type Express, type Router, type Request, type Response} from 'express'
import {requestContext, responseContext} from './context.js'
import makeDefer from 'jdefer'
import chain, { IChainable } from 'jchain'

export const expressApp = async (setup: (app: Express) => any) => {
	const symbol = Symbol('expressApp')

	const app = express()
	await setup(app)
	app.use((req, _res, _next) => req[symbol].resolve())
	app.use((err, req, _res, _next) => req[symbol].reject(err))
	return async next => {
		const req = requestContext.value
		const defer = makeDefer()
		req[symbol] = defer
		app(req, responseContext.value)
		await defer.promise
		await next()
	}
}

export const expressRouter = async (setup: (router: Router) => any) => {
	const symbol = Symbol('expressRouter')

	const router = express.Router()
	await setup(router)
	router.use((req, _res, _next) => req[symbol].resolve())
	router.use((err, req, _res, _next) => req[symbol].reject(err))
	return async next => {
		const req = requestContext.value
		const defer = makeDefer()
		req[symbol] = defer
		router(req, responseContext.value)
		await defer.promise
		await next()
	}
}

export const chainExpressMiddlewares = (...middlewares: Array<(req: Request, res: Response, next: () => any) => any>) => chain(
	...middlewares.map(middleware => (next => {
		middleware(requestContext.value, responseContext.value, next)
	}) satisfies IChainable)
)
