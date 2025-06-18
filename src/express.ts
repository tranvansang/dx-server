import express, {type Express, type Router} from 'express'
import {getReq, getRes} from './dx.js'

import './polyfillWithResolvers.js'

export async function expressApp(setup: (app: Express) => any) {
	const map = new WeakMap<Express.Request, PromiseWithResolvers<any>>()
	const app = express()
	await setup(app)
	app.use((req, _res, _next) => map.get(req)?.resolve())
	app.use((err, req, _res, _next) => map.get(req)?.reject(err))
	return async next => {
		const defer = Promise.withResolvers()
		const req = getReq()
		map.set(req, defer)
		app(req, getRes())
		await defer.promise
		await next()
	}
}

// can be used to chain existing Express app
export async function expressRouter(setup: (router: Router) => any) {
	const map = new WeakMap<Express.Request, PromiseWithResolvers<any>>()
	const router = express.Router()
	await setup(router)
	router.use((req, _res, _next) => map.get(req)?.resolve())
	router.use((err, req, _res, _next) => map.get(req)?.reject(err))
	return async next => {
		const defer = Promise.withResolvers()
		const req = getReq()
		map.set(req, defer)
		router(req, getRes())
		await defer.promise // if express middleware responses to the request, this will never resolve.
		await next()
	}
}
