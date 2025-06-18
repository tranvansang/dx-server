/**
 * Send module - Stream files with support for partial responses
 * Replaces the 'send' npm package
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { Stream } from 'node:stream'
import { IncomingMessage, ServerResponse } from 'node:http'
import {
  createHttpError,
  debug as createDebug,
  encodeUrl,
  escapeHtml,
  etag,
  fresh,
  ms,
  onFinished,
  parseRange,
  statuses,
  mime,
  contentRange,
  createHtmlDocument,
  clearHeaders,
  setHeaders,
  decode,
  normalizeList,
  hasListeners,
  containsDotFile,
  collapseLeadingSlashes,
  HttpError,
  Range,
  Ranges
} from './sendHelpers.js'

const debug = createDebug('send')

// Regular expressions
const BYTES_RANGE_REGEXP = /^ *bytes=/
const UP_PATH_REGEXP = /(?:^|[\\/])\\.\\.\\.?(?:[\\/]|$)/
const MAX_MAXAGE = 60 * 60 * 24 * 365 * 1000 // 1 year

export interface SendOptions {
  acceptRanges?: boolean
  cacheControl?: boolean
  dotfiles?: 'allow' | 'deny' | 'ignore'
  end?: number
  etag?: boolean
  extensions?: string[] | string | boolean
  immutable?: boolean
  index?: string[] | string | boolean
  lastModified?: boolean
  maxAge?: number | string
  maxage?: number | string
  root?: string
  start?: number
}

export interface SendStream extends Omit<Stream, 'pipe'> {
  req: IncomingMessage
  res: ServerResponse
  path: string
  options: SendOptions
  
  pipe(res: ServerResponse): ServerResponse
  maxage(val: number | string): this
  root(path: string): this
  index(paths: string[] | string): this
  hidden(val: boolean): this
  dotfiles(val: 'allow' | 'deny' | 'ignore'): this
  etag(val: boolean): this
  lastModified(val: boolean): this
  cacheControl(val: boolean): this
  acceptRanges(val: boolean): this
  immutable(val: boolean): this
  extensions(val: string[] | string): this
}

class SendStreamImpl extends Stream implements Omit<SendStream, keyof Stream> {
  req: IncomingMessage
  res!: ServerResponse
  path: string
  options: SendOptions
  
  private _acceptRanges: boolean
  private _cacheControl: boolean
  private _etag: boolean
  private _dotfiles: 'allow' | 'deny' | 'ignore'
  private _extensions: string[]
  private _immutable: boolean
  private _index: string[]
  private _lastModified: boolean
  private _maxage: number
  private _root: string | null

  constructor(req: IncomingMessage, path: string, options: SendOptions = {}) {
    super()
    
    this.req = req
    this.path = path
    this.options = options

    this._acceptRanges = options.acceptRanges !== undefined
      ? Boolean(options.acceptRanges)
      : true

    this._cacheControl = options.cacheControl !== undefined
      ? Boolean(options.cacheControl)
      : true

    this._etag = options.etag !== undefined
      ? Boolean(options.etag)
      : true

    this._dotfiles = options.dotfiles !== undefined
      ? options.dotfiles
      : 'ignore'

    if (this._dotfiles !== 'ignore' && this._dotfiles !== 'allow' && this._dotfiles !== 'deny') {
      throw new TypeError('dotfiles option must be "allow", "deny", or "ignore"')
    }

    this._extensions = options.extensions !== undefined
      ? normalizeList(options.extensions, 'extensions option')
      : []

    this._immutable = options.immutable !== undefined
      ? Boolean(options.immutable)
      : false

    this._index = options.index !== undefined
      ? normalizeList(options.index, 'index option')
      : ['index.html']

    this._lastModified = options.lastModified !== undefined
      ? Boolean(options.lastModified)
      : true

    this._maxage = options.maxAge || options.maxage || 0
    this._maxage = typeof this._maxage === 'string'
      ? ms(this._maxage) as number
      : Number(this._maxage)
    this._maxage = !isNaN(this._maxage)
      ? Math.min(Math.max(0, this._maxage), MAX_MAXAGE)
      : 0

    this._root = options.root
      ? path.resolve(options.root)
      : null
  }

  // Setters for chaining
  maxage(val: number | string): this {
    this._maxage = typeof val === 'string' ? ms(val) as number : Number(val)
    this._maxage = !isNaN(this._maxage)
      ? Math.min(Math.max(0, this._maxage), MAX_MAXAGE)
      : 0
    return this
  }

  root(rootPath: string): this {
    this._root = path.resolve(rootPath)
    return this
  }

  index(paths: string[] | string): this {
    this._index = normalizeList(paths, 'index option')
    return this
  }

  hidden(val: boolean): this {
    this._dotfiles = val ? 'allow' : 'ignore'
    return this
  }

  dotfiles(val: 'allow' | 'deny' | 'ignore'): this {
    if (val !== 'ignore' && val !== 'allow' && val !== 'deny') {
      throw new TypeError('dotfiles option must be "allow", "deny", or "ignore"')
    }
    this._dotfiles = val
    return this
  }

  etag(val: boolean): this {
    this._etag = Boolean(val)
    return this
  }

  lastModified(val: boolean): this {
    this._lastModified = Boolean(val)
    return this
  }

  cacheControl(val: boolean): this {
    this._cacheControl = Boolean(val)
    return this
  }

  acceptRanges(val: boolean): this {
    this._acceptRanges = Boolean(val)
    return this
  }

  immutable(val: boolean): this {
    this._immutable = Boolean(val)
    return this
  }

  extensions(val: string[] | string): this {
    this._extensions = normalizeList(val, 'extensions option')
    return this
  }

  // Error handling
  private error(status: number, err?: Error | HttpError): void {
    // emit if listeners instead of responding
    if (hasListeners(this, 'error')) {
      const httpError = createHttpError(status, err)
      this.emit('error', httpError)
      return
    }

    const res = this.res
    const msg = statuses.message[status] || String(status)
    const doc = createHtmlDocument('Error', escapeHtml(msg))

    // clear existing headers
    clearHeaders(res)

    // add error headers
    if (err && 'headers' in err && err.headers) {
      setHeaders(res, err.headers)
    }

    // send basic response
    res.statusCode = status
    res.setHeader('Content-Type', 'text/html; charset=UTF-8')
    res.setHeader('Content-Length', Buffer.byteLength(doc))
    res.setHeader('Content-Security-Policy', "default-src 'none'")
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.end(doc)
  }

  // Utility methods
  private hasTrailingSlash(): boolean {
    return this.path[this.path.length - 1] === '/'
  }

  private isConditionalGET(): boolean {
    return !!(
      this.req.headers['if-match'] ||
      this.req.headers['if-unmodified-since'] ||
      this.req.headers['if-none-match'] ||
      this.req.headers['if-modified-since']
    )
  }

  private isPreconditionFailure(): boolean {
    const req = this.req
    const res = this.res

    // if-match
    const match = req.headers['if-match']
    if (match) {
      const resEtag = res.getHeader('ETag')
      if (!resEtag) return true
      
      const etagStr = Array.isArray(resEtag) ? resEtag[0] : String(resEtag)
      
      if (match === '*') return false
      
      // Parse token list
      const matches = match.split(',').map(s => s.trim())
      return !matches.some(m => 
        m === etagStr || m === 'W/' + etagStr || 'W/' + m === etagStr
      )
    }

    // if-unmodified-since
    const unmodifiedSince = req.headers['if-unmodified-since']
    if (unmodifiedSince) {
      const unmodifiedDate = Date.parse(unmodifiedSince)
      if (!isNaN(unmodifiedDate)) {
        const lastModified = res.getHeader('Last-Modified')
        if (!lastModified) return false
        
        const lastModifiedStr = Array.isArray(lastModified) ? lastModified[0] : String(lastModified)
        const lastModifiedDate = Date.parse(lastModifiedStr)
        
        return isNaN(lastModifiedDate) || lastModifiedDate > unmodifiedDate
      }
    }

    return false
  }

  private removeContentHeaderFields(): void {
    const res = this.res
    res.removeHeader('Content-Encoding')
    res.removeHeader('Content-Language')
    res.removeHeader('Content-Length')
    res.removeHeader('Content-Range')
    res.removeHeader('Content-Type')
  }

  private notModified(): void {
    const res = this.res
    debug('not modified')
    this.removeContentHeaderFields()
    res.statusCode = 304
    res.end()
  }

  private headersAlreadySent(): void {
    const err = new Error("Can't set headers after they are sent.")
    debug('headers already sent')
    this.error(500, err)
  }

  private isCachable(): boolean {
    const statusCode = this.res.statusCode
    return (statusCode >= 200 && statusCode < 300) || statusCode === 304
  }

  private onStatError(error: NodeJS.ErrnoException): void {
    switch (error.code) {
      case 'ENAMETOOLONG':
      case 'ENOENT':
      case 'ENOTDIR':
        this.error(404, error)
        break
      default:
        this.error(500, error)
        break
    }
  }

  private isFresh(): boolean {
    const etag = this.res.getHeader('ETag')
    const lastModified = this.res.getHeader('Last-Modified')
    return fresh(this.req.headers, {
      etag: etag ? String(etag) : undefined,
      'last-modified': lastModified ? String(lastModified) : undefined
    })
  }

  private isRangeFresh(): boolean {
    const ifRange = this.req.headers['if-range']

    if (!ifRange) {
      return true
    }

    // if-range as etag
    if (ifRange.indexOf('"') !== -1) {
      const resEtag = this.res.getHeader('ETag')
      if (!resEtag) return false
      
      const etagStr = Array.isArray(resEtag) ? resEtag[0] : String(resEtag)
      return ifRange.indexOf(etagStr) !== -1
    }

    // if-range as modified date
    const lastModified = this.res.getHeader('Last-Modified')
    if (!lastModified) return true
    
    const lastModifiedStr = Array.isArray(lastModified) ? lastModified[0] : String(lastModified)
    return Date.parse(lastModifiedStr) <= Date.parse(ifRange)
  }

  private redirect(redirectPath: string): void {
    const res = this.res

    if (hasListeners(this, 'directory')) {
      this.emit('directory', res, redirectPath)
      return
    }

    if (this.hasTrailingSlash()) {
      this.error(403)
      return
    }

    const loc = encodeUrl(collapseLeadingSlashes(this.path + '/'))
    const doc = createHtmlDocument('Redirecting', 'Redirecting to ' + escapeHtml(loc))

    // redirect
    res.statusCode = 301
    res.setHeader('Content-Type', 'text/html; charset=UTF-8')
    res.setHeader('Content-Length', Buffer.byteLength(doc))
    res.setHeader('Content-Security-Policy', "default-src 'none'")
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Location', loc)
    res.end(doc)
  }

  // Main pipe method
  pipe(res: ServerResponse): ServerResponse {
    // root path
    const root = this._root

    // references
    this.res = res

    // decode the path
    const decodedPath = decode(this.path)
    if (decodedPath === -1) {
      this.error(400)
      return res
    }

    // null byte(s)
    if (~decodedPath.indexOf('\0')) {
      this.error(400)
      return res
    }

    let filePath = decodedPath
    let parts: string[]
    
    if (root !== null) {
      // normalize
      if (filePath) {
        filePath = path.normalize('.' + path.sep + filePath)
      }

      // malicious path
      if (UP_PATH_REGEXP.test(filePath)) {
        debug('malicious path "%s"', filePath)
        this.error(403)
        return res
      }

      // explode path parts
      parts = filePath.split(path.sep)

      // join / normalize from optional root dir
      filePath = path.normalize(path.join(root, filePath))
    } else {
      // ".." is malicious without "root"
      if (UP_PATH_REGEXP.test(filePath)) {
        debug('malicious path "%s"', filePath)
        this.error(403)
        return res
      }

      // explode path parts
      parts = path.normalize(filePath).split(path.sep)

      // resolve the path
      filePath = path.resolve(filePath)
    }

    // dotfile handling
    if (containsDotFile(parts)) {
      debug('%s dotfile "%s"', this._dotfiles, filePath)
      switch (this._dotfiles) {
        case 'allow':
          break
        case 'deny':
          this.error(403)
          return res
        case 'ignore':
        default:
          this.error(404)
          return res
      }
    }

    // index file support
    if (this._index.length && this.hasTrailingSlash()) {
      this.sendIndex(filePath)
      return res
    }

    this.sendFile(filePath)
    return res
  }

  // Send a file
  private send(filePath: string, stat: fs.Stats): void {
    let len = stat.size
    const options = this.options
    const opts: any = {}
    const res = this.res
    const req = this.req
    const ranges = req.headers.range
    let offset = options.start || 0

    if (res.headersSent) {
      // impossible to send now
      this.headersAlreadySent()
      return
    }

    debug('pipe "%s"', filePath)

    // set header fields
    this.setHeader(filePath, stat)

    // set content-type
    this.type(filePath)

    // conditional GET support
    if (this.isConditionalGET()) {
      if (this.isPreconditionFailure()) {
        this.error(412)
        return
      }

      if (this.isCachable() && this.isFresh()) {
        this.notModified()
        return
      }
    }

    // adjust len to start/end options
    len = Math.max(0, len - offset)
    if (options.end !== undefined) {
      const bytes = options.end - offset + 1
      if (len > bytes) len = bytes
    }

    // Range support
    if (this._acceptRanges && ranges && BYTES_RANGE_REGEXP.test(ranges)) {
      // parse
      const parsedRanges = parseRange(len, ranges, {
        combine: true
      })

      // If-Range support
      if (!this.isRangeFresh()) {
        debug('range stale')
        // Treat as regular response
      } else if (parsedRanges === -1) {
        // unsatisfiable
        debug('range unsatisfiable')

        // Content-Range
        res.setHeader('Content-Range', contentRange('bytes', len))

        // 416 Requested Range Not Satisfiable
        this.error(416, createHttpError(416, undefined, {
          headers: { 'Content-Range': res.getHeader('Content-Range') as string }
        }))
        return
      } else if (parsedRanges !== -2 && parsedRanges.length === 1) {
        // valid single range
        debug('range %j', parsedRanges)

        // Content-Range
        res.statusCode = 206
        res.setHeader('Content-Range', contentRange('bytes', len, parsedRanges[0]))

        // adjust for requested range
        offset += parsedRanges[0].start
        len = parsedRanges[0].end - parsedRanges[0].start + 1
      }
    }

    // clone options
    for (const prop in options) {
      opts[prop] = options[prop]
    }

    // set read options
    opts.start = offset
    opts.end = Math.max(offset, offset + len - 1)

    // content-length
    res.setHeader('Content-Length', len)

    // HEAD support
    if (req.method === 'HEAD') {
      res.end()
      return
    }

    this.stream(filePath, opts)
  }

  // Send file by path
  private sendFile(filePath: string): void {
    let i = 0
    const self = this

    debug('stat "%s"', filePath)
    fs.stat(filePath, function onstat(err, stat) {
      const pathEndsWithSep = filePath[filePath.length - 1] === path.sep
      if (err && err.code === 'ENOENT' && !path.extname(filePath) && !pathEndsWithSep) {
        // not found, check extensions
        return next(err)
      }
      if (err) return self.onStatError(err)
      if (stat.isDirectory()) return self.redirect(filePath)
      if (pathEndsWithSep) return self.error(404)
      self.emit('file', filePath, stat)
      self.send(filePath, stat)
    })

    function next(err?: NodeJS.ErrnoException): void {
      if (self._extensions.length <= i) {
        return err
          ? self.onStatError(err)
          : self.error(404)
      }

      const p = filePath + '.' + self._extensions[i++]

      debug('stat "%s"', p)
      fs.stat(p, function (err, stat) {
        if (err) return next(err)
        if (stat.isDirectory()) return next()
        self.emit('file', p, stat)
        self.send(p, stat)
      })
    }
  }

  // Send index files
  private sendIndex(dirPath: string): void {
    let i = -1
    const self = this

    function next(err?: NodeJS.ErrnoException): void {
      if (++i >= self._index.length) {
        if (err) return self.onStatError(err)
        return self.error(404)
      }

      const filePath = path.join(dirPath, self._index[i])

      debug('stat "%s"', filePath)
      fs.stat(filePath, function (err, stat) {
        if (err) return next(err)
        if (stat.isDirectory()) return next()
        self.emit('file', filePath, stat)
        self.send(filePath, stat)
      })
    }

    next()
  }

  // Stream file to response
  private stream(filePath: string, options: any): void {
    const self = this
    const res = this.res

    // pipe
    const stream = fs.createReadStream(filePath, options)
    this.emit('stream', stream)
    stream.pipe(res)

    // cleanup
    function cleanup() {
      stream.destroy()
    }

    // response finished, cleanup
    onFinished(res, cleanup)

    // error handling
    stream.on('error', function onerror(err) {
      // clean up stream early
      cleanup()

      // error
      self.onStatError(err as NodeJS.ErrnoException)
    })

    // end
    stream.on('end', function onend() {
      self.emit('end')
    })
  }

  // Set content-type
  private type(filePath: string): void {
    const res = this.res

    if (res.getHeader('Content-Type')) return

    const type = mime.contentType(path.extname(filePath)) || 'application/octet-stream'

    debug('content-type %s', type)
    res.setHeader('Content-Type', type)
  }

  // Set response headers
  private setHeader(filePath: string, stat: fs.Stats): void {
    const res = this.res

    this.emit('headers', res, filePath, stat)

    if (this._acceptRanges && !res.getHeader('Accept-Ranges')) {
      debug('accept ranges')
      res.setHeader('Accept-Ranges', 'bytes')
    }

    if (this._cacheControl && !res.getHeader('Cache-Control')) {
      let cacheControl = 'public, max-age=' + Math.floor(this._maxage / 1000)

      if (this._immutable) {
        cacheControl += ', immutable'
      }

      debug('cache-control %s', cacheControl)
      res.setHeader('Cache-Control', cacheControl)
    }

    if (this._lastModified && !res.getHeader('Last-Modified')) {
      const modified = stat.mtime.toUTCString()
      debug('modified %s', modified)
      res.setHeader('Last-Modified', modified)
    }

    if (this._etag && !res.getHeader('ETag')) {
      const val = etag(stat)
      debug('etag %s', val)
      res.setHeader('ETag', val)
    }
  }
}

// Main export function
export function send(req: IncomingMessage, pathname: string, options?: SendOptions): SendStream {
  return new SendStreamImpl(req, pathname, options)
}

// Export types
export type { HttpError, Range, Ranges } from './sendHelpers.js'