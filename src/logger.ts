import {getReq, getRes} from './dx.js'
import {hrtime} from 'node:process'

export function logJson(json: any) {
	console.log(JSON.stringify(json))
}

let requestCount = 0
export default (log = logJson) => function logger(next: () => any) {
	const res = getRes()
	const req = getReq()
	const logId = requestCount++

	const start = hrtime.bigint()
	const now = new Date(Date.now() + 9 * 60 * 60 * 1000) // jst

	log({
		level: 'info',
		id: logId,
		timestamp: [
			[
				now.getUTCFullYear(),
				String(now.getUTCMonth() + 1).padStart(2, '0'),
				String(now.getUTCDate()).padStart(2, '0'),
			].join('-'),
			[
				String(now.getUTCHours()).padStart(2, '0'),
				String(now.getUTCMinutes()).padStart(2, '0'),
				[String(now.getUTCSeconds()).padStart(2, '0'), String(now.getUTCMilliseconds()).padStart(3, '0')].join('.'),
			].join(':'),
		].join('T'),
		remoteAddress: req.socket.remoteAddress,
		method: req.method,
		url: req.url,
		httpVersion: `HTTP/${req.httpVersion}`,
		headers:
			process.env.NODE_ENV === 'production'
				? req.headers
				: Object.fromEntries(
					Object.entries(req.headers).filter(([k]) =>
						[
							'host',
							'referer',
							'referrer',
							'user-agent',
							'x-forwarded-proto',
							'x-forwarded-host',
							'x-forwarded-for',
						].includes(k),
					),
				),
	})

	res.once('finish', end).once('close', end).once('error', end)

	return next()

	function end() {
		res.off('finish', end).off('close', end).off('error', end)
		const durationNs = hrtime.bigint() - start
		log({
			level: 'info',
			id: logId,
			duration: Number(durationNs) / 1e6, // ms
			headers: res.getHeaders(),
		})
	}
}
