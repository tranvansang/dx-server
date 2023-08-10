import express, {type Express, type Router} from 'express'
import {requestContext, responseContext} from './context.js'
import {IChainable} from 'jchain'
import makeDefer from 'jdefer'

export const expressApp = (setup: (app: Express) => any) => {
	const symbol = Symbol('expressApp')

	const app = express()
	setup(app)
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

export const expressRouter = (setup: (router: Router) => any) => {
	const symbol = Symbol('expressRouter')

	const router = express.Router()
	setup(router)
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
