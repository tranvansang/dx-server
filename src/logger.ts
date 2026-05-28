import {getReq, getRes} from './dx.js'
import {hrtime} from 'node:process'

export function logJson(json: any) {
	console.log(JSON.stringify(json))
}

let requestCount = 0
export default function makeLogger(log = logJson) {
	return function logger(next: () => any) {
		const res = getRes()
		const req = getReq()
		const logId = requestCount++
		const start = hrtime.bigint()

		log({
			level: 'info',
			id: logId,
			timestamp: new Date().toISOString(),
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
}
