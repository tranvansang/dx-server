/**
 * Helper functions for the send module
 * Replaces external dependencies: escape-html, encodeurl, ms, etag, fresh, statuses, http-errors, debug, on-finished, range-parser, mime-types
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { IncomingMessage, ServerResponse } from 'node:http'

// escape-html implementation
const matchHtmlRegExp = /["'&<>]/

export function escapeHtml(string: string): string {
  const str = '' + string
  const match = matchHtmlRegExp.exec(str)

  if (!match) {
    return str
  }

  let escape: string
  let html = ''
  let index = 0
  let lastIndex = 0

  for (index = match.index; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34: // "
        escape = '&quot;'
        break
      case 38: // &
        escape = '&amp;'
        break
      case 39: // '
        escape = '&#39;'
        break
      case 60: // <
        escape = '&lt;'
        break
      case 62: // >
        escape = '&gt;'
        break
      default:
        continue
    }

    if (lastIndex !== index) {
      html += str.substring(lastIndex, index)
    }

    lastIndex = index + 1
    html += escape
  }

  return lastIndex !== index
    ? html + str.substring(lastIndex, index)
    : html
}

// encodeurl implementation
const ENCODE_CHARS_REGEXP = /(?:[^\x21\x23-\x3B\x3D\x3F-\x5F\x61-\x7A\x7C\x7E]|%(?:[^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|$))+/g
const UNMATCHED_SURROGATE_PAIR_REGEXP = /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF]([^\uDC00-\uDFFF]|$)/g
const UNMATCHED_SURROGATE_PAIR_REPLACE = '$1\uFFFD$2'

export function encodeUrl(url: string): string {
  return String(url)
    .replace(UNMATCHED_SURROGATE_PAIR_REGEXP, UNMATCHED_SURROGATE_PAIR_REPLACE)
    .replace(ENCODE_CHARS_REGEXP, encodeURI)
}

// ms implementation
const s = 1000
const m = s * 60
const h = m * 60
const d = h * 24
const w = d * 7
const y = d * 365.25

export function ms(val: string | number, options?: { long?: boolean }): number | string {
  options = options || {}
  const type = typeof val
  if (type === 'string' && val.length > 0) {
    return parse(val as string)
  } else if (type === 'number' && isFinite(val as number)) {
    return options.long ? fmtLong(val as number) : fmtShort(val as number)
  }
  throw new Error('val is not a non-empty string or a valid number. val=' + JSON.stringify(val))
}

function parse(str: string): number {
  str = String(str)
  if (str.length > 100) return NaN
  
  const match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(str)
  
  if (!match) return NaN
  
  const n = parseFloat(match[1])
  const type = (match[2] || 'ms').toLowerCase()
  
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y':
      return n * y
    case 'weeks':
    case 'week':
    case 'w':
      return n * w
    case 'days':
    case 'day':
    case 'd':
      return n * d
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h':
      return n * h
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm':
      return n * m
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      return n * s
    case 'milliseconds':
    case 'millisecond':
    case 'msecs':
    case 'msec':
    case 'ms':
      return n
    default:
      return NaN
  }
}

function fmtShort(ms: number): string {
  const msAbs = Math.abs(ms)
  if (msAbs >= d) return Math.round(ms / d) + 'd'
  if (msAbs >= h) return Math.round(ms / h) + 'h'
  if (msAbs >= m) return Math.round(ms / m) + 'm'
  if (msAbs >= s) return Math.round(ms / s) + 's'
  return ms + 'ms'
}

function fmtLong(ms: number): string {
  const msAbs = Math.abs(ms)
  if (msAbs >= d) return plural(ms, msAbs, d, 'day')
  if (msAbs >= h) return plural(ms, msAbs, h, 'hour')
  if (msAbs >= m) return plural(ms, msAbs, m, 'minute')
  if (msAbs >= s) return plural(ms, msAbs, s, 'second')
  return ms + ' ms'
}

function plural(ms: number, msAbs: number, n: number, name: string): string {
  const isPlural = msAbs >= n * 1.5
  return Math.round(ms / n) + ' ' + name + (isPlural ? 's' : '')
}

// etag implementation
export function etag(entity: string | Buffer | fs.Stats, options?: { weak?: boolean }): string {
  if (entity == null) {
    throw new TypeError('argument entity is required')
  }

  const isStats = isstats(entity)
  const weak = options && typeof options.weak === 'boolean'
    ? options.weak
    : isStats

  if (!isStats && typeof entity !== 'string' && !Buffer.isBuffer(entity)) {
    throw new TypeError('argument entity must be string, Buffer, or fs.Stats')
  }

  const tag = isStats
    ? stattag(entity as fs.Stats)
    : entitytag(entity as string | Buffer)

  return weak ? 'W/' + tag : tag
}

function isstats(obj: any): obj is fs.Stats {
  // Check if it's an fs.Stats object
  return obj && typeof obj === 'object' && 'ctime' in obj && 'mtime' in obj && 'size' in obj
}

function entitytag(entity: string | Buffer): string {
  if (entity.length === 0) {
    // Fast-path: return pre-computed empty entity tag
    return '"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"'
  }

  // Compute hash of entity
  const hash = crypto
    .createHash('sha1')
    .update(typeof entity === 'string' ? entity : entity.toString(), 'utf8')
    .digest('base64')
    .substring(0, 27)

  // Compute length of entity
  const len = typeof entity === 'string'
    ? Buffer.byteLength(entity, 'utf8')
    : entity.length

  return '"' + len.toString(16) + '-' + hash + '"'
}

function stattag(stat: fs.Stats): string {
  const mtime = stat.mtime.getTime().toString(16)
  const size = stat.size.toString(16)
  return '"' + size + '-' + mtime + '"'
}

// fresh implementation
export function fresh(reqHeaders: IncomingMessage['headers'], resHeaders: { [key: string]: string | string[] | undefined }): boolean {
  // Check for conditional headers
  const modifiedSince = reqHeaders['if-modified-since']
  const noneMatch = reqHeaders['if-none-match']

  // Unconditional request
  if (!modifiedSince && !noneMatch) {
    return false
  }

  // Check for no-cache directive
  const cacheControl = reqHeaders['cache-control']
  if (cacheControl && /(?:^|,)\s*?no-cache\s*?(?:,|$)/.test(cacheControl)) {
    return false
  }

  // If-None-Match
  if (noneMatch && noneMatch !== '*') {
    const etag = resHeaders.etag || resHeaders.ETag

    if (!etag) {
      return false
    }

    const etagStr = Array.isArray(etag) ? etag[0] : etag
    let etagStale = true
    const matches = parseTokenList(noneMatch)
    
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      if (match === etagStr || match === 'W/' + etagStr || 'W/' + match === etagStr) {
        etagStale = false
        break
      }
    }

    if (etagStale) {
      return false
    }
  }

  // If-Modified-Since
  if (modifiedSince) {
    const lastModified = resHeaders['last-modified'] || resHeaders['Last-Modified']
    const lastModifiedStr = Array.isArray(lastModified) ? lastModified[0] : lastModified
    const modifiedStale = !lastModifiedStr || 
      !(parseHttpDate(lastModifiedStr) <= parseHttpDate(modifiedSince))

    if (modifiedStale) {
      return false
    }
  }

  return true
}

function parseTokenList(str: string): string[] {
  let end = 0
  const list: string[] = []
  let start = 0

  // gather tokens
  for (let i = 0, len = str.length; i < len; i++) {
    switch (str.charCodeAt(i)) {
      case 0x20: /*   */
        if (start === end) {
          start = end = i + 1
        }
        break
      case 0x2c: /* , */
        if (start !== end) {
          list.push(str.substring(start, end))
        }
        start = end = i + 1
        break
      default:
        end = i + 1
        break
    }
  }

  // final token
  if (start !== end) {
    list.push(str.substring(start, end))
  }

  return list
}

function parseHttpDate(date: string): number {
  const timestamp = date && Date.parse(date)
  return typeof timestamp === 'number' ? timestamp : NaN
}

// statuses implementation
export const statuses = {
  // Status code to message mapping
  message: {
    100: 'Continue',
    101: 'Switching Protocols',
    102: 'Processing',
    103: 'Early Hints',
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    203: 'Non-Authoritative Information',
    204: 'No Content',
    205: 'Reset Content',
    206: 'Partial Content',
    207: 'Multi-Status',
    208: 'Already Reported',
    226: 'IM Used',
    300: 'Multiple Choices',
    301: 'Moved Permanently',
    302: 'Found',
    303: 'See Other',
    304: 'Not Modified',
    305: 'Use Proxy',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    407: 'Proxy Authentication Required',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Payload Too Large',
    414: 'URI Too Long',
    415: 'Unsupported Media Type',
    416: 'Range Not Satisfiable',
    417: 'Expectation Failed',
    418: "I'm a Teapot",
    421: 'Misdirected Request',
    422: 'Unprocessable Entity',
    423: 'Locked',
    424: 'Failed Dependency',
    425: 'Too Early',
    426: 'Upgrade Required',
    428: 'Precondition Required',
    429: 'Too Many Requests',
    431: 'Request Header Fields Too Large',
    451: 'Unavailable For Legal Reasons',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    505: 'HTTP Version Not Supported',
    506: 'Variant Also Negotiates',
    507: 'Insufficient Storage',
    508: 'Loop Detected',
    510: 'Not Extended',
    511: 'Network Authentication Required'
  } as { [key: number]: string },

  // Special status groups
  redirect: {
    300: true, 301: true, 302: true, 303: true,
    305: true, 307: true, 308: true
  } as const,

  empty: {
    204: true, 205: true, 304: true
  } as const,

  retry: {
    502: true, 503: true, 504: true
  } as const
}

// http-errors implementation
export interface HttpError extends Error {
  status: number
  statusCode: number
  expose: boolean
  headers?: { [key: string]: string }
}

export function createHttpError(status: number, err?: Error | string | { [key: string]: any }, props?: { expose?: boolean, headers?: { [key: string]: string } }): HttpError {
  let message: string
  let expose = false
  
  if (typeof err === 'string') {
    message = err
  } else if (err instanceof Error) {
    message = err.message
  } else if (err && typeof err === 'object') {
    message = err.message || statuses.message[status] || String(status)
    Object.assign(props || {}, err)
  } else {
    message = statuses.message[status] || String(status)
  }

  if (props) {
    expose = props.expose !== undefined ? props.expose : status < 500
  } else {
    expose = status < 500
  }

  const error = new Error(message) as HttpError
  error.status = status
  error.statusCode = status
  error.expose = expose
  
  if (props && props.headers) {
    error.headers = props.headers
  }

  Error.captureStackTrace(error, createHttpError)
  
  return error
}

// debug implementation (simplified)
const debuggers: { [key: string]: (...args: any[]) => void } = {}
const DEBUG = process.env.DEBUG || ''

export function debug(namespace: string): (...args: any[]) => void {
  const log = (...args: any[]) => {
    if (isEnabled(namespace)) {
      console.error(`${namespace} ${args.join(' ')}`)
    }
  }
  
  log.extend = (suffix: string) => debug(`${namespace}:${suffix}`)
  
  debuggers[namespace] = log
  return log
}

function isEnabled(namespace: string): boolean {
  if (!DEBUG) return false
  
  const patterns = DEBUG.split(',').map(p => p.trim())
  
  for (const pattern of patterns) {
    if (pattern === '*') return true
    if (pattern === namespace) return true
    if (pattern.endsWith('*') && namespace.startsWith(pattern.slice(0, -1))) return true
  }
  
  return false
}

// on-finished implementation
export function onFinished(msg: IncomingMessage | ServerResponse, callback: (err?: Error | null, msg?: IncomingMessage | ServerResponse) => void): void {
  if (isFinished(msg)) {
    setImmediate(() => callback(null, msg))
    return
  }

  let finished = false
  
  const onfinish = () => {
    if (finished) return
    finished = true
    callback(null, msg)
  }
  
  const onerror = (err: Error) => {
    if (finished) return
    finished = true
    callback(err, msg)
  }
  
  if (msg instanceof ServerResponse) {
    msg.once('finish', onfinish)
    msg.once('error', onerror)
  } else {
    msg.once('end', onfinish)
    msg.once('error', onerror)
    msg.once('close', onfinish)
  }
}

export function isFinished(msg: IncomingMessage | ServerResponse): boolean {
  if (msg instanceof ServerResponse) {
    return Boolean(msg.writableEnded || msg.finished)
  } else {
    const socket = (msg as any).socket
    return Boolean(
      msg.readableEnded ||
      (msg as any).complete ||
      (socket && !socket.readable) ||
      (!socket && (msg as IncomingMessage).readable === false)
    )
  }
}

// range-parser implementation
export interface Range {
  start: number
  end: number
}

export interface Ranges extends Array<Range> {
  type: string
}

export function parseRange(size: number, header: string, options?: { combine?: boolean }): Ranges | -1 | -2 {
  if (typeof header !== 'string') {
    return -2
  }

  const index = header.indexOf('=')
  if (index === -1) {
    return -2
  }

  const type = header.slice(0, index).trim()
  const rangeStr = header.slice(index + 1).trim()

  // Invalid type
  if (type !== 'bytes') {
    return -1
  }

  const ranges: Range[] = []
  const rangeSpecs = rangeStr.split(',')

  for (let i = 0; i < rangeSpecs.length; i++) {
    const rangeSpec = rangeSpecs[i].trim()
    const dash = rangeSpec.indexOf('-')
    
    if (dash === -1) {
      return -2
    }

    const startStr = rangeSpec.slice(0, dash).trim()
    const endStr = rangeSpec.slice(dash + 1).trim()

    let start: number
    let end: number

    if (startStr === '') {
      // Suffix range
      start = size - parseInt(endStr, 10)
      end = size - 1
    } else if (endStr === '') {
      // Open-ended range
      start = parseInt(startStr, 10)
      end = size - 1
    } else {
      // Normal range
      start = parseInt(startStr, 10)
      end = parseInt(endStr, 10)
    }

    // Check for invalid range
    if (isNaN(start) || isNaN(end) || start < 0 || end < 0 || start > end || start >= size) {
      continue
    }

    // Cap end at size - 1
    if (end >= size) {
      end = size - 1
    }

    ranges.push({ start, end })
  }

  if (ranges.length === 0) {
    return -1
  }

  if (options && options.combine) {
    return combineRanges(ranges, type)
  }

  const result = ranges as Ranges
  result.type = type
  return result
}

function combineRanges(ranges: Range[], type: string): Ranges {
  ranges.sort((a, b) => a.start - b.start)

  const combined: Range[] = []
  let current = ranges[0]

  for (let i = 1; i < ranges.length; i++) {
    const range = ranges[i]
    
    if (range.start <= current.end + 1) {
      // Ranges overlap or are adjacent
      current.end = Math.max(current.end, range.end)
    } else {
      // Ranges don't overlap
      combined.push(current)
      current = range
    }
  }

  combined.push(current)

  const result = combined as Ranges
  result.type = type
  return result
}

// mime-types implementation (simplified)
const mimeTypes: { [key: string]: string } = {
  // Text
  'txt': 'text/plain',
  'html': 'text/html',
  'htm': 'text/html',
  'css': 'text/css',
  'csv': 'text/csv',
  'md': 'text/markdown',
  'markdown': 'text/markdown',
  
  // Application
  'js': 'application/javascript',
  'mjs': 'application/javascript',
  'json': 'application/json',
  'xml': 'application/xml',
  'pdf': 'application/pdf',
  'zip': 'application/zip',
  'gz': 'application/gzip',
  'tar': 'application/x-tar',
  'rar': 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  
  // Images
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'svg': 'image/svg+xml',
  'ico': 'image/x-icon',
  'bmp': 'image/bmp',
  
  // Audio
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'ogg': 'audio/ogg',
  'flac': 'audio/flac',
  'm4a': 'audio/mp4',
  
  // Video
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'ogv': 'video/ogg',
  'mov': 'video/quicktime',
  'avi': 'video/x-msvideo',
  'mkv': 'video/x-matroska',
  
  // Fonts
  'ttf': 'font/ttf',
  'otf': 'font/otf',
  'woff': 'font/woff',
  'woff2': 'font/woff2',
  'eot': 'application/vnd.ms-fontobject',
}

const charsets: { [key: string]: string } = {
  'text/plain': 'UTF-8',
  'text/html': 'UTF-8',
  'text/css': 'UTF-8',
  'text/csv': 'UTF-8',
  'text/markdown': 'UTF-8',
  'application/javascript': 'UTF-8',
  'application/json': 'UTF-8',
  'application/xml': 'UTF-8',
  'image/svg+xml': 'UTF-8'
}

export const mime = {
  lookup(pathOrExtension: string): string | false {
    if (!pathOrExtension || typeof pathOrExtension !== 'string') {
      return false
    }

    // Get the extension
    const ext = path.extname(pathOrExtension).toLowerCase().slice(1)
    
    if (!ext) {
      // Try the whole string as extension
      const cleanExt = pathOrExtension.toLowerCase().replace(/^\./, '')
      return mimeTypes[cleanExt] || false
    }

    return mimeTypes[ext] || false
  },

  contentType(type: string): string | false {
    if (!type || typeof type !== 'string') {
      return false
    }

    // If it doesn't contain '/', assume it's an extension
    if (!type.includes('/')) {
      const mimeType = this.lookup(type)
      if (!mimeType) return false
      type = mimeType
    }

    // Add charset if applicable
    const charset = charsets[type]
    if (charset) {
      return `${type}; charset=${charset.toLowerCase()}`
    }

    return type
  },

  extension(type: string): string | false {
    if (!type || typeof type !== 'string') {
      return false
    }

    // Remove parameters
    type = type.split(';')[0].trim()

    // Find extension
    for (const [ext, mimeType] of Object.entries(mimeTypes)) {
      if (mimeType === type) {
        return ext
      }
    }

    return false
  },

  charset(type: string): string | false {
    if (!type || typeof type !== 'string') {
      return false
    }

    // Remove parameters
    type = type.split(';')[0].trim()

    return charsets[type] || false
  }
}

// Content-Range helper
export function contentRange(type: string, size: number, range?: Range): string {
  return type + ' ' + (range ? range.start + '-' + range.end : '*') + '/' + size
}

// Create HTML document helper
export function createHtmlDocument(title: string, body: string): string {
  return '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<title>' + title + '</title>\n' +
    '</head>\n' +
    '<body>\n' +
    '<pre>' + body + '</pre>\n' +
    '</body>\n' +
    '</html>\n'
}

// Path helpers
export function containsDotFile(parts: string[]): boolean {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part.length > 1 && part[0] === '.') {
      return true
    }
  }
  return false
}

export function collapseLeadingSlashes(str: string): string {
  let i = 0
  for (; i < str.length; i++) {
    if (str[i] !== '/') {
      break
    }
  }
  return i > 1 ? '/' + str.substr(i) : str
}

// HTTP helpers
export function clearHeaders(res: ServerResponse): void {
  const names = res.getHeaderNames()
  for (const name of names) {
    res.removeHeader(name)
  }
}

export function setHeaders(res: ServerResponse, headers: { [key: string]: string | string[] }): void {
  const keys = Object.keys(headers)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    res.setHeader(key, headers[key])
  }
}

// Decode helper
export function decode(path: string): string | -1 {
  try {
    return decodeURIComponent(path)
  } catch (err) {
    return -1
  }
}

// Normalize list helper
export function normalizeList(val: any, name: string): string[] {
  const list = [].concat(val || [])

  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] !== 'string') {
      throw new TypeError(name + ' must be array of strings or false')
    }
  }

  return list
}

// Has listeners helper
export function hasListeners(emitter: NodeJS.EventEmitter, type: string): boolean {
  const count = typeof emitter.listenerCount === 'function'
    ? emitter.listenerCount(type)
    : emitter.listeners(type).length

  return count > 0
}