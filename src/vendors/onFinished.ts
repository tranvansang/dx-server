/**
 * Variables.
 * @private
 */

/* istanbul ignore next */
import {AsyncResource} from 'node:async_hooks'

var defer = typeof setImmediate === 'function'
	? setImmediate
	: function (fn) { process.nextTick(fn.bind.apply(fn, arguments)) }

/**
 * Invoke callback when the response has finished, useful for
 * cleaning up resources afterwards.
 *
 * @param {object} msg
 * @param {function} listener
 * @return {object}
 * @public
 */

export function onFinished (msg, listener) {
	if (isFinished(msg) !== false) {
		defer(listener, null, msg)
		return msg
	}

	// attach the listener to the message
	attachListener(msg, wrap(listener))

	return msg
}

/**
 * Determine if message is already finished.
 *
 * @param {object} msg
 * @return {boolean}
 * @public
 */

function isFinished (msg) {
	var socket = msg.socket

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

function attachFinishedListener (msg, callback) {
	var eeMsg
	var eeSocket
	var finished = false

	function onFinish (error) {
		eeMsg.cancel()
		eeSocket.cancel()

		finished = true
		callback(error)
	}

	// finished on first message event
	eeMsg = eeSocket = first([[msg, 'end', 'finish']], onFinish)

	function onSocket (socket) {
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

function attachListener (msg, listener) {
	var attached = msg.__onFinished

	// create a private single listener with queue
	if (!attached || !attached.queue) {
		attached = msg.__onFinished = createListener(msg)
		attachFinishedListener(msg, attached)
	}

	attached.queue.push(listener)
}

/**
 * Create listener on message.
 *
 * @param {object} msg
 * @return {function}
 * @private
 */

function createListener (msg) {
	function listener (err) {
		if (msg.__onFinished === listener) msg.__onFinished = null
		if (!listener.queue) return

		var queue = listener.queue
		listener.queue = null

		for (var i = 0; i < queue.length; i++) {
			queue[i](err, msg)
		}
	}

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
function patchAssignSocket (res, callback) {
	var assignSocket = res.assignSocket

	if (typeof assignSocket !== 'function') return

	// res.on('socket', callback) is broken in 0.8
	res.assignSocket = function _assignSocket (socket) {
		assignSocket.call(this, socket)
		callback(socket)
	}
}

/**
 * Try to require async_hooks
 * @private
 */

function tryRequireAsyncHooks () {
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

function wrap (fn) {
	var res

	// create anonymous resource
	res = new AsyncResource(fn.name || 'bound-anonymous-fn')

	// incompatible node.js
	if (!res || !res.runInAsyncScope) {
		return fn
	}

	// return bound function
	return res.runInAsyncScope.bind(res, fn, null)
}

/**
 * Get the first event in a set of event emitters and event pairs.
 *
 * @param {array} stuff
 * @param {function} done
 * @public
 */

function first (stuff, done) {
	if (!Array.isArray(stuff)) {
		throw new TypeError('arg must be an array of [ee, events...] arrays')
	}

	var cleanups = []

	for (var i = 0; i < stuff.length; i++) {
		var arr = stuff[i]

		if (!Array.isArray(arr) || arr.length < 2) {
			throw new TypeError('each array member must be [ee, events...]')
		}

		var ee = arr[0]

		for (var j = 1; j < arr.length; j++) {
			var event = arr[j]
			var fn = listener(event, callback)

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

	function callback () {
		cleanup()
		done.apply(null, arguments)
	}

	function cleanup () {
		var x
		for (var i = 0; i < cleanups.length; i++) {
			x = cleanups[i]
			x.ee.removeListener(x.event, x.fn)
		}
	}

	function thunk (fn) {
		done = fn
	}

	thunk.cancel = cleanup

	return thunk
}

/**
 * Create the event listener.
 * @private
 */

function listener (event, done) {
	return function onevent (arg1) {
		var args = new Array(arguments.length)
		var ee = this
		var err = event === 'error'
			? arg1
			: null

		// copy args to prevent arguments escaping scope
		for (var i = 0; i < args.length; i++) {
			args[i] = arguments[i]
		}

		done(err, ee, event, args)
	}
}
