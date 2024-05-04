if (Promise.withResolvers === undefined) {
	Promise.withResolvers = function withResolvers<T = void>() {
		let resolve = undefined
		let reject = undefined
		const promise = new Promise<T>((rs, rj) => {
			resolve = rs
			reject = rj
		})
		return {
			resolve,
			reject,
			promise
		}
	}
}
