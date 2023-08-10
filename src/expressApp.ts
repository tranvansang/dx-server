import express, {type Express} from 'express'
import {requestContext, responseContext} from './context.js'

export const expressApp = (setup: (app: Express) => any) => {
	const app = express()
	setup(app)
	return app.bind(app, requestContext.value, responseContext.value)
}
