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
	const defer = Promise.withResolvers<void>()
	send(req, pathname, options)
		.on('error', e => defer.reject(e))
		.on('end', () => defer.resolve())
		.pipe(res)

	return defer.promise
}
