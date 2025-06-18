import {Chainable, getReq} from './dx.js'
import {urlFromReq} from './bodyHelpers.js'

interface URLPatternOptions {
	// sensitive?: boolean // default false
	// strict?: boolean // default false. disallow trailing delimiter
}

interface RouteContext {
	matched: URLPatternResult
	next(): any
}
interface Route {(context: RouteContext): any}
interface Routes {[k: string]: Route}

interface RouterOptions extends URLPatternOptions {
	prefix?: string
}

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods
const allMethods = [
	'get', 'head', 'post', 'put', 'delete', 'connect', 'options', 'trace', 'patch'
] as const
// typescript does not support method multi-signature for object properties
// type Router = {
// 	[K in typeof allMethods[number]]: ((routes: Routes, options?: RouterOptions) => Chainable)
// 	| ((pattern: string, route: Route, options?: RouterOptions) => Chainable)
// } & {
type Router = {
	patch(routes: Routes, options?: RouterOptions): Chainable
	patch(pattern: string, route: Route, options?: RouterOptions): Chainable
	trace(routes: Routes, options?: RouterOptions): Chainable
	trace(pattern: string, route: Route, options?: RouterOptions): Chainable
	options(routes: Routes, options?: RouterOptions): Chainable
	options(pattern: string, route: Route, options?: RouterOptions): Chainable
	connect(routes: Routes, options?: RouterOptions): Chainable
	connect(pattern: string, route: Route, options?: RouterOptions): Chainable
	delete(routes: Routes, options?: RouterOptions): Chainable
	delete(pattern: string, route: Route, options?: RouterOptions): Chainable
	put(routes: Routes, options?: RouterOptions): Chainable
	put(pattern: string, route: Route, options?: RouterOptions): Chainable
	post(routes: Routes, options?: RouterOptions): Chainable
	post(pattern: string, route: Route, options?: RouterOptions): Chainable
	head(routes: Routes, options?: RouterOptions): Chainable
	head(pattern: string, route: Route, options?: RouterOptions): Chainable
	get(routes: Routes, options?: RouterOptions): Chainable
	get(pattern: string, route: Route, options?: RouterOptions): Chainable
	all(routes: Routes, options?: RouterOptions): Chainable
	all(pattern: string, route: Route, options?: RouterOptions): Chainable
	method(method: string, routes: Routes, options?: RouterOptions): Chainable
	method(method: string, pattern: string, route: Route, options?: RouterOptions): Chainable
}

function makeRouter(
	method: string | undefined, // undefined means any method
	routes: [pattern: string, route: Route][],
	{prefix = '', ...options}: RouterOptions = {},
): Chainable {
	const routeWithUrlPatterns = routes.map(([pattern, handler]) => [new URLPattern({pathname: `${prefix}${pattern}`}), handler])
	return next => {
		const req = getReq()
		if (method !== undefined && req.method !== method.toUpperCase()) return next()
		for (const [urlPattern, handler] of routeWithUrlPatterns) {
// '' matches nothing
// '/' matches both https://example.com and https://example.com/
// '/foo' matches https://example.com/foo but not https://example.com/foo/
// '/foo/' matches https://example.com/foo/ but not https://example.com/foo

			// path can be '*' for OPTIONS request
			// to test: curl -X OPTIONS --request-target '*' http://localhost:3000 -D -
			// req.url === '*'
			// new URL('*', 'https://example.com').pathname === '/*'
			const matched = urlPattern.exec({pathname: urlFromReq(req).pathname})
			if (matched) return handler({matched, next})
		}
		return next()
	}
}
export const router: Router = {
	method(method, ...params) {
		return typeof params[0] === 'string'
			? makeRouter(method, [[params[0], params[1]]], params[2])
			: makeRouter(method, Object.entries(params[0]), params[1])
	},
	all(...params) {
		return typeof params[0] === 'string'
			? makeRouter(undefined, [[params[0], params[1]]], params[2])
			: makeRouter(undefined, Object.entries(params[0]), params[1])
	}
}

for (const method of allMethods) router[method] = router.method.bind(router, method)
