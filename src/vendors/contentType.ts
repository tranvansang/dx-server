
// https://github.com/jshttp/content-type/blob/d02574e9640bd4370f148c767b1b877b5a300070/index.js#L106
/**
 * RegExp to match type in RFC 7231 sec 3.1.1.1
 *
 * media-type = type "/" subtype
 * type       = token
 * subtype    = token
 */
const TYPE_REGEXP = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
/**
 * RegExp to match *( ";" parameter ) in RFC 7231 sec 3.1.1.1
 *
 * parameter     = token "=" ( token / quoted-string )
 * token         = 1*tchar
 * tchar         = "!" / "#" / "$" / "%" / "&" / "'" / "*"
 *               / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
 *               / DIGIT / ALPHA
 *               ; any VCHAR, except delimiters
 * quoted-string = DQUOTE *( qdtext / quoted-pair ) DQUOTE
 * qdtext        = HTAB / SP / %x21 / %x23-5B / %x5D-7E / obs-text
 * obs-text      = %x80-FF
 * quoted-pair   = "\" ( HTAB / SP / VCHAR / obs-text )
 */
const PARAM_REGEXP = /; *([!#$%&'*+.^_`|~0-9A-Za-z-]+) *= *("(?:[\u000b\u0020\u0021\u0023-\u005b\u005d-\u007e\u0080-\u00ff]|\\[\u000b\u0020-\u00ff])*"|[!#$%&'*+.^_`|~0-9A-Za-z-]+) */g // eslint-disable-line no-control-regex
const TEXT_REGEXP = /^[\u000b\u0020-\u007e\u0080-\u00ff]+$/ // eslint-disable-line no-control-regex
const TOKEN_REGEXP = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
/**
 * RegExp to match quoted-pair in RFC 7230 sec 3.2.6
 *
 * quoted-pair = "\" ( HTAB / SP / VCHAR / obs-text )
 * obs-text    = %x80-FF
 */
const QESC_REGEXP = /\\([\u000b\u0020-\u00ff])/g // eslint-disable-line no-control-regex

export function parseContentType (header: string) {
	let index = header.indexOf(';')
	const mediaType = index !== -1
		? header.slice(0, index).trim()
		: header.trim()

	if (!TYPE_REGEXP.test(mediaType)) throw new TypeError(`invalid media type: ${mediaType}`)
	const parameters: Record<string, string> = Object.create(null)

	// parse parameters
	if (index !== -1) {
		let key
		let match
		let value

		const regexp = new RegExp(PARAM_REGEXP)
		regexp.lastIndex = index

		while ((match = regexp.exec(header))) {
			if (match.index !== index) throw new TypeError('invalid parameter format')

			index += match[0].length
			key = match[1].toLowerCase()
			value = match[2]

			if (value.charCodeAt(0) === 0x22 /* " */) {
				// remove quotes
				value = value.slice(1, -1)
				// remove escapes
				if (value.indexOf('\\') !== -1) value = value.replace(QESC_REGEXP, '$1')
			}

			parameters[key] = value
		}

		if (index !== header.length) throw new TypeError('invalid parameter format')
	}

	return {mediaType, parameters}
}

/**
 * RegExp to match chars that must be quoted-pair in RFC 7230 sec 3.2.6
 */
const QUOTE_REGEXP = /([\\"])/g
function qstring (str: string) {
	// no need to quote tokens
	if (TOKEN_REGEXP.test(str)) return str

	if (str.length > 0 && !TEXT_REGEXP.test(str)) throw new TypeError(`invalid parameter value: ${str}`)
	return `"${str.replace(QUOTE_REGEXP, '\\$1')}"`
}

function formatContentType({mediaType, parameters}: {
	mediaType: string
	parameters?: Record<string, string>
}) {
	if (!mediaType || !TYPE_REGEXP.test(mediaType)) throw new TypeError(`invalid type: ${mediaType}`)
	return `${mediaType}${
		parameters
			? Object.keys(parameters).sort().map(key => `; ${key}=${qstring(parameters[key])}`).join('')
			: ''
	}`
}
