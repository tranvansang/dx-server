import express, {type Express, type Router} from 'express'
import makeDefer from 'jdefer'
import {getReq, getRes} from './dx.js'

export async function expressApp(setup: (app: Express) => any) {
	const symbol = Symbol('expressApp')

	const app = express()
	await setup(app)
	app.use((req, _res, _next) => req[symbol].resolve())
	app.use((err, req, _res, _next) => req[symbol].reject(err))
	return async next => {
		const defer = makeDefer()
		getReq()[symbol] = defer
		app(getReq(), getRes())
		await defer.promise
		await next()
	}
}

// can be used to chain existing Express app
export async function expressRouter(setup: (router: Router) => any) {
	const symbol = Symbol('expressRouter')

	const router = express.Router()
	await setup(router)
	router.use((req, _res, _next) => req[symbol].resolve())
	router.use((err, req, _res, _next) => req[symbol].reject(err))
	return async next => {
		const defer = makeDefer()
		getReq()[symbol] = defer
		router(getReq(), getRes())
		await defer.promise // if express middleware handles the request, this will never resolve.
		await next()
	}
}
