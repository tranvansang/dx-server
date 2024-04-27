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

function compilePath(path: string, options: RegexpToPathOptions) {
	const cacheKey = JSON.stringify(options)
	const pathCache = cache[cacheKey] || (cache[cacheKey] = {})
	if (pathCache[path]) return pathCache[path]

	const keys: Key[] = []
	const regexp = pathToRegexp(path, keys, options)
	const result = {
		regexp,
		keys
	}

	if (cacheCount < cacheLimit) {
		pathCache[path] = result
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
	next(): any
	params: Record<Key['name'], string>
}
interface RouteDefinition {
	[k: string]: (p: RouteContext) => any
}

interface RouterOptions extends RegexpToPathOptions {
	prefix?: string
}

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods
const allMethods = [
	'get', 'head', 'post', 'put', 'delete', 'connect', 'options', 'trace', 'patch'
] as const
type IRouter = {
	[K in typeof allMethods[number]]: (definition: RouteDefinition, options?: RouterOptions) => Chainable
} & {
	all(definition: RouteDefinition, options?: RouterOptions): Chainable
	method(method: string, definition: RouteDefinition, options?: RouterOptions): Chainable
}

export const router: IRouter = {
	method(method, router, {prefix = '', ...options}: RouterOptions = {}) {
		return next => {
			const req = getReq()
			if (req.method !== method.toUpperCase()) return next()
			for (const [pattern, handler] of Object.entries(router)) {
				const match = matchPattern(urlFromReq(req).pathname, `${prefix}${pattern}`, options)
				if (match) return handler({
					...match,
					next,
				})
			}
			return next()
		}
	},
	all(router, {prefix = '', ...options}: RouterOptions = {}) {
		return next => {
			const req = getReq()
			for (const [pattern, handler] of Object.entries(router)) {
				const match = matchPattern(urlFromReq(req).pathname, `${prefix}${pattern}`, options)
				if (match) return handler({
					...match,
					next,
				})
			}
			return next()
		}
	}
}

for (const method of allMethods) router[method] = router.method.bind(router, method)
