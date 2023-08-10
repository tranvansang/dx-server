import { type IChainable } from 'jchain'
import {setHtml, setJson} from './express.js'
import {router} from './route.js'

export const catchError: IChainable = async next => {
	try {
		await next()
	} catch (e) {
		console.error(e)
		setHtml('internal server error', {status: 500})
	}
}

export const catchApiError = router.post({
	async '/api'({next}) {
		try {
			await next()
		} catch (e) {
			console.error(e)
			setJson({
				message: 'internal server error',
				code: 'internal_server_error'
			}, {status: 500})
		}
	}
}, {end: false})

export const notFound: IChainable = () => {
	setHtml('not found', {status: 404})
}
export const notFoundApi = router.post({
	'/api'() {
		setJson({
			message: 'not found',
			code: 'not_found'
		}, {status: 404})
	}
}, {end: false})
