import send, {SendOptions} from 'send'
import {IncomingMessage, ServerResponse} from 'node:http'
import './polyfillWithResolvers.js'

export function sendFile(
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string, // url encoded path, not plain path
	options: SendOptions | undefined,
	next: () => any,
	) {
	const defer = Promise.withResolvers()
	send(req, pathname, options)
		.on('error', async err => {
			if (err.code !== 'ENOENT') defer.reject(err)
			else {
				try {
					defer.resolve(next())
				} catch (e) {
					defer.reject(e)
				}
			}
		})
		.on('end', () => defer.resolve())
		.pipe(res)

	return defer.promise
}
