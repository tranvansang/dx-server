import type {Key} from 'path-to-regexp'
import {pathToRegexp} from 'path-to-regexp'
import {Chainable, getReq} from './dx.js'
import {urlFromReq} from './bodyHelpers.js'

const cache: Record<string, any> = {}
const cacheLimit = 10000
let cacheCount = 0

interface RegexpToPathOptions {
	end?: boolean // default true. match till end of string
	strict?: boolean // default false. disallow trailing delimiter
	sensitive?: boolean // default false
	start?: boolean // default true. match from beginning of string

	delimiter?: string // default '/#?'. delimiter for segments
	endsWith?: string // default undefined. optional character that matches at the end of the string
	encode?(value: string): string // default x => x. encode strings before inserting into RegExp
	prefixes?: string // default `./`. List of characters to automatically consider prefixes when parsing.
}

function compilePath(pattern: string, options: RegexpToPathOptions) {
	const cacheKey = JSON.stringify(options)
	const pathCache = cache[cacheKey] || (cache[cacheKey] = {})
	if (pathCache[pattern]) return pathCache[pattern]

	const keys: Key[] = []
	const regexp = pathToRegexp(pattern, keys, options)
	const result = {
		regexp,
		keys
	}

	if (cacheCount < cacheLimit) {
		pathCache[pattern] = result
		cacheCount++
	}
	return result
}

export function matchPattern<Params extends Record<Key['name'], string>>(
	pathname: string,
	pattern: string,
	options?: RegexpToPathOptions,
) {
	options = {...options}
	options.end ??= true
	options.strict ??= false
	options.sensitive ??= false
	options.start ??= true

	if (!pattern && pattern !== '') return

	const {regexp, keys} = compilePath(pattern, options)
	const match = regexp.exec(pathname)
	if (!match) return

	const [matched, ...values] = match

	return {
		matched, // the matched portion of the URL
		params: keys.reduce((acc: Record<Key['name'], string>, key: Key, index: number) => {
			acc[key.name] = values[index]
			return acc
		}, {} as Params)
	}
}

interface RouteContext {
	matched: string
	params: Record<Key['name'], string>
	next(): any
}
interface Route {(context: RouteContext): any}
interface Routes {[k: string]: Route}

interface RouterOptions extends RegexpToPathOptions {
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
	return next => {
		const req = getReq()
		if (method !== undefined && req.method !== method.toUpperCase()) return next()
		for (const [pattern, handler] of routes) {
			const match = matchPattern(urlFromReq(req).pathname, `${prefix}${pattern}`, options)
			if (match) return handler({
				...match,
				next,
			})
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
