import {test} from 'node:test'
import {ok, strictEqual} from 'node:assert/strict'
import {Server, request} from 'node:http'
import type {AddressInfo} from 'node:net'
import {Readable} from 'node:stream'
import {writeFileSync, mkdtempSync, rmSync, chmodSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import dxServer, {setFile, setNodeStream, setWebStream} from '../lib/index.js'

// Invariant under test (for every code path):
//   dxServer(req, res)(handler) must resolve only AFTER res.writableFinished === true
//   (or the socket is destroyed). The chain must never resolve while bytes are still
//   buffered in res or while the response has not been ended.

test('setFile with a missing file ends the response within 2s', async () => {
	const server = makeServer(() => setFile('/nonexistent/dx-server-c1-regression.txt'))
	const port = await listen(server)

	try {
		const status = await Promise.race([fetchStatus(port), timeout(2000)])
		ok(status !== 'timeout', 'response hung — setFile error was swallowed without res.end() (C1)')
		ok(typeof status === 'number' && status >= 400 && status < 600, `expected 4xx/5xx for missing file, got ${status}`)
	} finally {
		await closeServer(server)
	}
})

test('setFile to a directory ends the response within 2s', async () => {
	const server = makeServer(() => setFile(import.meta.dirname))
	const port = await listen(server)

	try {
		const status = await Promise.race([fetchStatus(port), timeout(2000)])
		ok(status !== 'timeout', 'response hung — setFile(directory) error was swallowed (C1)')
		strictEqual(typeof status, 'number')
	} finally {
		await closeServer(server)
	}
})

test(
	'setFile to an unreadable file responds 403 within 2s (no hang/reset)',
	{skip: process.getuid?.() === 0 ? 'chmod 000 does not deny root' : false},
	async () => {
		const dir = mkdtempSync(join(tmpdir(), 'dx-server-test-'))
		const filePath = join(dir, 'secret.txt')
		writeFileSync(filePath, 'topsecret')
		chmodSync(filePath, 0o000)

		const server = makeServer(() => setFile(filePath))
		const port = await listen(server)

		try {
			const status = await Promise.race([fetchStatus(port), timeout(2000)])
			ok(status !== 'timeout', 'response hung — EACCES left writeRes awaiting res.end() on a destroyed res')
			strictEqual(status, 403, `expected 403 for an unreadable file, got ${status}`)
		} finally {
			chmodSync(filePath, 0o600)
			rmSync(dir, {recursive: true, force: true})
			await closeServer(server)
		}
	},
)

test('setFile happy path: chain resolves only after res.writableFinished', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-server-test-'))
	const filePath = join(dir, 'payload.bin')
	writeFileSync(filePath, Buffer.alloc(64 * 1024, 0x41))

	const {chainResolvedBeforeFinish, status} = await runAndObserve(() => setFile(filePath))
	rmSync(dir, {recursive: true, force: true})

	strictEqual(status, 200)
	strictEqual(
		chainResolvedBeforeFinish,
		false,
		'chain resolved before res emitted finish — bytes may still be buffered',
	)
})

test('setNodeStream: chain resolves only after res.writableFinished', async () => {
	const {chainResolvedBeforeFinish, status} = await runAndObserve(() => {
		setNodeStream(Readable.from([Buffer.alloc(32 * 1024, 0x42), Buffer.alloc(32 * 1024, 0x43)]))
	})
	strictEqual(status, 200)
	strictEqual(
		chainResolvedBeforeFinish,
		false,
		'setNodeStream: chain resolved before res finished — pipe was not awaited',
	)
})

test('setWebStream: chain resolves only after res.writableFinished', async () => {
	const {chainResolvedBeforeFinish, status} = await runAndObserve(() => {
		const web = new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(32 * 1024).fill(0x44))
				controller.enqueue(new Uint8Array(32 * 1024).fill(0x45))
				controller.close()
			},
		})
		setWebStream(web)
	})
	strictEqual(status, 200)
	strictEqual(
		chainResolvedBeforeFinish,
		false,
		'setWebStream: chain resolved before res finished — pipe was not awaited',
	)
})

test('no setter called: response is ended within 2s (not hung)', async () => {
	const server = makeServer(() => {})
	const port = await listen(server)

	try {
		const status = await Promise.race([fetchStatus(port), timeout(2000)])
		ok(status !== 'timeout', 'response hung — no setter called and writeRes left res open')
		strictEqual(typeof status, 'number')
	} finally {
		await closeServer(server)
	}
})

function makeServer(handler: () => void) {
	return new Server((req, res) => {
		dxServer(
			req,
			res,
		)(async () => handler()).catch(() => {
			if (res.writableEnded) return
			res.statusCode = 500
			res.end()
		})
	})
}

// Spin up a server whose handler records res 'finish' timing vs chain-promise timing,
// fetch one response, and report whether the chain resolved before res finished.
async function runAndObserve(handler: () => void) {
	let resFinishedAt = 0
	let chainResolvedAt = 0

	const server = new Server((req, res) => {
		res.once('finish', () => {
			resFinishedAt = nowNs()
		})
		dxServer(
			req,
			res,
		)(async () => handler())
			.then(() => {
				chainResolvedAt = nowNs()
			})
			.catch(() => {
				chainResolvedAt = nowNs()
				if (!res.writableEnded) {
					res.statusCode = 500
					res.end()
				}
			})
	})
	const port = await listen(server)

	try {
		const status = await Promise.race([fetchStatus(port), timeout(2000)])
		if (status === 'timeout') throw new Error('request timed out')
		// Give res 'finish' one tick to land if it hasn't already.
		await new Promise<void>(resolve => setImmediate(resolve))
		return {
			status,
			chainResolvedBeforeFinish: resFinishedAt === 0 || chainResolvedAt < resFinishedAt,
		}
	} finally {
		await closeServer(server)
	}
}

function nowNs() {
	return Number(process.hrtime.bigint())
}

function listen(server: Server) {
	return new Promise<number>(resolve =>
		server.listen(0, () => {
			resolve((server.address() as AddressInfo).port)
		}),
	)
}

async function closeServer(server: Server) {
	server.closeAllConnections?.()
	await new Promise<void>(resolve => server.close(() => resolve()))
}

function fetchStatus(port: number) {
	return new Promise<number>((resolve, reject) => {
		const req = request({port, path: '/'}, res => {
			res.resume()
			res.on('end', () => resolve(res.statusCode ?? 0))
			res.on('error', reject)
		})
		req.on('error', reject)
		req.end()
	})
}

function timeout(ms: number) {
	return new Promise<'timeout'>(resolve => {
		setTimeout(() => resolve('timeout'), ms).unref()
	})
}
