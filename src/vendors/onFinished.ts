/**
 * Variables.
 * @private
 */

/* istanbul ignore next */
import {AsyncResource} from 'node:async_hooks'

const defer: (fn: (...a: any[]) => void, ...args: any[]) => void = typeof setImmediate === 'function'
	? setImmediate
	: function (this: any, fn: (...a: any[]) => void) {
		process.nextTick(fn.bind.apply(fn, arguments as any))
	}

/**
 * Invoke callback when the response has finished, useful for
 * cleaning up resources afterwards.
 *
 * @param {object} msg
 * @param {function} listener
 * @return {object}
 * @public
 */

export function onFinished<T>(msg: T, listener: (err: any, msg?: any) => void) {
	if (isFinished(msg as any) !== false) {
		defer(listener, null, msg)
		return msg
	}

	// attach the listener to the message
	attachListener(msg as any, wrap(listener))

	return msg
}

/**
 * Determine if message is already finished.
 *
 * @param {object} msg
 * @return {boolean}
 * @public
 */

function isFinished(msg: any) {
	const socket = msg.socket

	if (typeof msg.finished === 'boolean') {
		// OutgoingMessage
		return Boolean(msg.finished || (socket && !socket.writable))
	}

	if (typeof msg.complete === 'boolean') {
		// IncomingMessage
		return Boolean(msg.upgrade || !socket || !socket.readable || (msg.complete && !msg.readable))
	}

	// don't know
	return undefined
}

/**
 * Attach a finished listener to the message.
 *
 * @param {object} msg
 * @param {function} callback
 * @private
 */

function attachFinishedListener(msg: any, callback: (error?: any) => void) {
	let eeMsg: any
	let eeSocket: any
	let finished = false

	function onFinish(error: any) {
		eeMsg.cancel()
		eeSocket.cancel()

		finished = true
		callback(error)
	}

	// finished on first message event
	eeMsg = eeSocket = first([[msg, 'end', 'finish']], onFinish)

	function onSocket(socket: any) {
		// remove listener
		msg.removeListener('socket', onSocket)

		if (finished) return
		if (eeMsg !== eeSocket) return

		// finished on first socket event
		eeSocket = first([[socket, 'error', 'close']], onFinish)
	}

	if (msg.socket) {
		// socket already assigned
		onSocket(msg.socket)
		return
	}

	// wait for socket to be assigned
	msg.on('socket', onSocket)

	if (msg.socket === undefined) {
		// istanbul ignore next: node.js 0.8 patch
		patchAssignSocket(msg, onSocket)
	}
}

/**
 * Attach the listener to the message.
 *
 * @param {object} msg
 * @return {function}
 * @private
 */

interface AttachedListener {
	(err: any, msg?: any): void
	queue: Array<(err: any, msg?: any) => void> | null
}

function attachListener(msg: any, listener: (err: any, msg?: any) => void) {
	let attached: AttachedListener | undefined = msg.__onFinished

	// create a private single listener with queue
	if (!attached || !attached.queue) {
		attached = msg.__onFinished = createListener(msg)
		attachFinishedListener(msg, attached!)
	}

	attached!.queue!.push(listener)
}

/**
 * Create listener on message.
 *
 * @param {object} msg
 * @return {function}
 * @private
 */

function createListener(msg: any) {
	const listener = ((err: any) => {
		if (msg.__onFinished === listener) msg.__onFinished = null
		if (!listener.queue) return

		const queue = listener.queue
		listener.queue = null

		for (let i = 0; i < queue.length; i++) {
			queue[i](err, msg)
		}
	}) as AttachedListener

	listener.queue = []

	return listener
}

/**
 * Patch ServerResponse.prototype.assignSocket for node.js 0.8.
 *
 * @param {ServerResponse} res
 * @param {function} callback
 * @private
 */

// istanbul ignore next: node.js 0.8 patch
function patchAssignSocket(res: any, callback: (socket: any) => void) {
	const assignSocket = res.assignSocket

	if (typeof assignSocket !== 'function') return

	// res.on('socket', callback) is broken in 0.8
	res.assignSocket = function _assignSocket(this: any, socket: any) {
		assignSocket.call(this, socket)
		callback(socket)
	}
}

/**
 * Try to require async_hooks
 * @private
 */

function tryRequireAsyncHooks() {
	try {
		return require('async_hooks')
	} catch (e) {
		return {}
	}
}

/**
 * Wrap function with async resource, if possible.
 * AsyncResource.bind static method backported.
 * @private
 */

function wrap<F extends (...args: any[]) => any>(fn: F) {
	// create anonymous resource
	const res = new AsyncResource(fn.name || 'bound-anonymous-fn')

	// incompatible node.js
	if (!res || !res.runInAsyncScope) {
		return fn
	}

	// return bound function
	return res.runInAsyncScope.bind(res, fn, null) as unknown as F
}

/**
 * Get the first event in a set of event emitters and event pairs.
 *
 * @param {array} stuff
 * @param {function} done
 * @public
 */

function first(stuff: any[][], done: (...args: any[]) => void) {
	if (!Array.isArray(stuff)) {
		throw new TypeError('arg must be an array of [ee, events...] arrays')
	}

	const cleanups: {ee: any, event: string, fn: (...args: any[]) => void}[] = []

	for (let i = 0; i < stuff.length; i++) {
		const arr = stuff[i]

		if (!Array.isArray(arr) || arr.length < 2) {
			throw new TypeError('each array member must be [ee, events...]')
		}

		const ee = arr[0]

		for (let j = 1; j < arr.length; j++) {
			const event = arr[j]
			const fn = listener(event, callback)

			// listen to the event
			ee.on(event, fn)
			// push this listener to the list of cleanups
			cleanups.push({
				ee: ee,
				event: event,
				fn: fn
			})
		}
	}

	function callback(this: any, ...args: any[]) {
		cleanup()
		done.apply(null, args)
	}

	function cleanup() {
		for (let i = 0; i < cleanups.length; i++) {
			const x = cleanups[i]
			x.ee.removeListener(x.event, x.fn)
		}
	}

	const thunk = function thunk(fn: (...args: any[]) => void) {
		done = fn
	} as {
		(fn: (...args: any[]) => void): void
		cancel: () => void
	}

	thunk.cancel = cleanup

	return thunk
}

/**
 * Create the event listener.
 * @private
 */

function listener(event: string, done: (...args: any[]) => void) {
	return function onevent(this: any, arg1: any) {
		const args = new Array(arguments.length)
		const ee = this
		const err = event === 'error'
			? arg1
			: null

		// copy args to prevent arguments escaping scope
		for (let i = 0; i < args.length; i++) {
			args[i] = arguments[i]
		}

		done(err, ee, event, args)
	}
}
