import express, {type Express, type Request, type Response, type Router} from 'express'
import {requestContext, responseContext} from './context.js'
import makeDefer from 'jdefer'

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

export const expressMiddlewares = (
	...middlewares: Array<(req: Request, res: Response, next: () => any) => any>
) => expressRouter(router => router.use(...middlewares))
