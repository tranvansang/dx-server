import {test} from 'node:test'
import {strictEqual, deepEqual, ok, throws, match} from 'node:assert/strict'
import {writeFileSync, mkdtempSync, rmSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseRange} from '../lib/vendors/rangeParser.js'
import {entityTag, entityTagPath, statTag, isFreshETag, isFreshModifiedSince} from '../lib/vendors/etag.js'
import {fresh, parseHttpDate, parseTokenList} from '../lib/vendors/fresh.js'
import {parseContentType} from '../lib/vendors/contentType.js'
import {contentTypeForExtension} from '../lib/vendors/mime.js'
import {mimeScore} from '../lib/vendors/mimeScore.js'

// ---------------------------------------------------------------------------
// rangeParser.ts
// ---------------------------------------------------------------------------

test('parseRange: non-string str throws TypeError', () => {
	throws(() => parseRange(100, undefined as unknown as string), TypeError)
	throws(() => parseRange(100, 5 as unknown as string), TypeError)
})

test('parseRange: string without "=" returns -2', () => {
	strictEqual(parseRange(100, 'abc'), -2)
})

test('parseRange: more ranges than maxRanges returns -1', () => {
	strictEqual(parseRange(100, 'bytes=0-1,2-3,4-5', {maxRanges: 2}), -1)
})

test('parseRange: suffix form bytes=-5 (start NaN branch)', () => {
	const ranges = parseRange(100, 'bytes=-5')
	ok(ranges !== -1 && ranges !== -2)
	deepEqual([...ranges], [{start: 95, end: 99}])
})

test('parseRange: open-ended bytes=5- (end NaN branch)', () => {
	const ranges = parseRange(100, 'bytes=5-')
	ok(ranges !== -1 && ranges !== -2)
	deepEqual([...ranges], [{start: 5, end: 99}])
})

test('parseRange: end greater than size-1 is clamped', () => {
	const ranges = parseRange(10, 'bytes=0-500')
	ok(ranges !== -1 && ranges !== -2)
	deepEqual([...ranges], [{start: 0, end: 9}])
})

test('parseRange: all-invalid ranges return -1', () => {
	// start > size-1 -> start>end after clamp, so skipped; nothing valid -> -1
	strictEqual(parseRange(100, 'bytes=200-300'), -1)
})

test('parseRange: invalid ranges skipped, valid kept', () => {
	// 50-40 has start>end (skip), -1 has start<0 (skip), 0-4 valid
	const ranges = parseRange(100, 'bytes=50-40,0-4')
	ok(ranges !== -1 && ranges !== -2)
	deepEqual([...ranges], [{start: 0, end: 4}])
})

test('parseRange: .type equals part before "="', () => {
	const ranges = parseRange(100, 'items=0-4')
	ok(ranges !== -1 && ranges !== -2)
	strictEqual(ranges.type, 'items')
})

test('parseRange: combine omitted returns raw ranges', () => {
	const ranges = parseRange(30, 'bytes=0-4,3-8,20-25')
	deepEqual(
		[...(ranges as {start: number; end: number}[])],
		[
			{start: 0, end: 4},
			{start: 3, end: 8},
			{start: 20, end: 25},
		],
	)
})

test('parseRange: combine merges overlapping/adjacent ranges', () => {
	const ranges = parseRange(30, 'bytes=0-4,3-8,20-25', {combine: true})
	ok(ranges !== -1 && ranges !== -2)
	deepEqual(
		[...(ranges as {start: number; end: number}[])],
		[
			{start: 0, end: 8},
			{start: 20, end: 25},
		],
	)
	strictEqual(ranges.type, 'bytes')
})

test('parseRange: combine preserves original order via index sort', () => {
	// later range comes first numerically; combine must re-sort by original index
	const ranges = parseRange(100, 'bytes=20-25,0-4', {combine: true})
	deepEqual(
		[...(ranges as {start: number; end: number}[])],
		[
			{start: 20, end: 25},
			{start: 0, end: 4},
		],
	)
})

// ---------------------------------------------------------------------------
// etag.ts
// ---------------------------------------------------------------------------

test('entityTag: empty buffer returns fixed empty tag', () => {
	strictEqual(entityTag(Buffer.from('')), '"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"')
})

test('entityTag: non-empty buffer returns quoted hash with size hex', () => {
	const tag = entityTag(Buffer.from('hello'))
	strictEqual(tag, '"5-qvTGHdzF6KLavt4PO0gs2a6pQ00"')
	match(tag, /^"[0-9a-f]+-.+"$/)
})

test('statTag: formats "<sizehex>-<mtimehex>"', () => {
	const stat = {size: 1234, mtime: new Date(1000000000000)} as ReturnType<typeof statSync>
	strictEqual(statTag(stat), `"${(1234).toString(16)}-${(1000000000000).toString(16)}"`)
})

test('entityTagPath: hashes a real file', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dx-vendors-'))
	const file = join(dir, 'data.txt')
	try {
		writeFileSync(file, 'hello')
		const stat = statSync(file)
		const tag = await entityTagPath(stat, file)
		match(tag, new RegExp(`^"${stat.size.toString(16)}-.+"$`))
		// same bytes as Buffer.from('hello') -> same hash portion
		strictEqual(tag, entityTag(Buffer.from('hello')))
	} finally {
		rmSync(dir, {recursive: true, force: true})
	}
})

test('isFreshETag: missing if-none-match returns undefined', () => {
	strictEqual(isFreshETag(req({}), '"x"'), undefined)
})

test('isFreshETag: if-none-match "*" returns true', () => {
	strictEqual(isFreshETag(req({'if-none-match': '*'}), '"x"'), true)
})

test('isFreshETag: cache-control no-cache returns undefined', () => {
	strictEqual(isFreshETag(req({'if-none-match': '"x"', 'cache-control': 'no-cache'}), '"x"'), undefined)
})

test('isFreshETag: exact match returns true', () => {
	strictEqual(isFreshETag(req({'if-none-match': '"x"'}), '"x"'), true)
})

test('isFreshETag: W/-prefixed request token matches strong etag', () => {
	strictEqual(isFreshETag(req({'if-none-match': 'W/"x"'}), '"x"'), true)
})

test('isFreshETag: request token matches W/-prefixed etag', () => {
	strictEqual(isFreshETag(req({'if-none-match': '"x"'}), 'W/"x"'), true)
})

test('isFreshETag: non-matching token returns undefined', () => {
	strictEqual(isFreshETag(req({'if-none-match': '"y"'}), '"x"'), undefined)
})

test('isFreshETag: empty etag with conditional returns undefined', () => {
	strictEqual(isFreshETag(req({'if-none-match': '"x"'}), ''), undefined)
})

test('isFreshETag: matches one token within a list', () => {
	strictEqual(isFreshETag(req({'if-none-match': '"a", "b", "x"'}), '"x"'), true)
})

test('isFreshModifiedSince: missing if-modified-since returns undefined', () => {
	strictEqual(isFreshModifiedSince(req({}), 'Wed, 21 Oct 2015 07:28:00 GMT'), undefined)
})

test('isFreshModifiedSince: cache-control no-cache returns undefined', () => {
	const headers = {'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT', 'cache-control': 'no-cache'}
	strictEqual(isFreshModifiedSince(req(headers), 'Wed, 21 Oct 2015 07:28:00 GMT'), undefined)
})

test('isFreshModifiedSince: fresh (lastModified <= modifiedSince) returns true', () => {
	const r = req({'if-modified-since': 'Wed, 21 Oct 2015 08:00:00 GMT'})
	strictEqual(isFreshModifiedSince(r, 'Wed, 21 Oct 2015 07:28:00 GMT'), true)
})

test('isFreshModifiedSince: stale returns false', () => {
	const r = req({'if-modified-since': 'Wed, 21 Oct 2015 06:00:00 GMT'})
	strictEqual(isFreshModifiedSince(r, 'Wed, 21 Oct 2015 07:28:00 GMT'), false)
})

test('isFreshModifiedSince: header present but no lastModified returns true', () => {
	// modifiedSince truthy, lastModified falsy -> skips the if block, returns true
	const r = req({'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT'})
	strictEqual(isFreshModifiedSince(r, ''), true)
})

test('isFreshModifiedSince: unparseable dates return false', () => {
	const r = req({'if-modified-since': 'garbage'})
	strictEqual(isFreshModifiedSince(r, 'also garbage'), false)
})

// ---------------------------------------------------------------------------
// fresh.ts
// ---------------------------------------------------------------------------

test('fresh: no if-modified-since and no if-none-match returns false', () => {
	strictEqual(fresh({}, {}), false)
})

test('fresh: cache-control no-cache returns false', () => {
	strictEqual(fresh({'if-none-match': '"x"', 'cache-control': 'no-cache'}, {etag: '"x"'}), false)
})

test('fresh: if-none-match "*" returns true', () => {
	strictEqual(fresh({'if-none-match': '*'}, {}), true)
})

test('fresh: if-none-match matches etag returns true', () => {
	strictEqual(fresh({'if-none-match': '"x"'}, {etag: '"x"'}), true)
})

test('fresh: if-none-match W/ variants match', () => {
	strictEqual(fresh({'if-none-match': 'W/"x"'}, {etag: '"x"'}), true)
	strictEqual(fresh({'if-none-match': '"x"'}, {etag: 'W/"x"'}), true)
})

test('fresh: if-none-match with no response etag returns false', () => {
	strictEqual(fresh({'if-none-match': '"x"'}, {}), false)
})

test('fresh: if-none-match non-match returns false', () => {
	strictEqual(fresh({'if-none-match': '"y"'}, {etag: '"x"'}), false)
})

test('fresh: if-modified-since fresh returns true', () => {
	const reqHeaders = {'if-modified-since': 'Wed, 21 Oct 2015 08:00:00 GMT'}
	const resHeaders = {'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT'}
	strictEqual(fresh(reqHeaders, resHeaders), true)
})

test('fresh: if-modified-since stale returns false', () => {
	const reqHeaders = {'if-modified-since': 'Wed, 21 Oct 2015 06:00:00 GMT'}
	const resHeaders = {'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT'}
	strictEqual(fresh(reqHeaders, resHeaders), false)
})

test('fresh: if-modified-since with missing last-modified returns false', () => {
	strictEqual(fresh({'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT'}, {}), false)
})

test('parseHttpDate: valid date returns a number', () => {
	const ts = parseHttpDate('Tue, 01 Jan 1980 00:00:01 GMT')
	strictEqual(typeof ts, 'number')
	ok(!isNaN(ts))
})

test('parseHttpDate: undefined returns NaN', () => {
	ok(isNaN(parseHttpDate(undefined)))
})

test('parseHttpDate: garbage returns NaN', () => {
	ok(isNaN(parseHttpDate('garbage')))
})

test('parseTokenList: splits on commas trimming leading spaces', () => {
	deepEqual(parseTokenList('a, b ,c'), ['a', 'b', 'c'])
})

test('parseTokenList: single token', () => {
	deepEqual(parseTokenList('abc'), ['abc'])
})

// ---------------------------------------------------------------------------
// contentType.ts
// ---------------------------------------------------------------------------

test('parseContentType: bare media type has empty parameters', () => {
	const result = parseContentType('text/plain')
	strictEqual(result.mediaType, 'text/plain')
	deepEqual({...result.parameters}, {})
})

test('parseContentType: parses charset parameter', () => {
	const result = parseContentType('application/json; charset=utf-8')
	strictEqual(result.mediaType, 'application/json')
	strictEqual(result.parameters.charset, 'utf-8')
})

test('parseContentType: unescapes quoted value with escapes', () => {
	const result = parseContentType('text/plain; foo="a\\"b"')
	strictEqual(result.parameters.foo, 'a"b')
})

test('parseContentType: quoted value without escapes', () => {
	const result = parseContentType('text/plain; foo="bar baz"')
	strictEqual(result.parameters.foo, 'bar baz')
})

test('parseContentType: invalid media type throws TypeError', () => {
	throws(() => parseContentType('/'), TypeError)
	throws(() => parseContentType('foo'), TypeError)
})

test('parseContentType: malformed parameter throws TypeError', () => {
	throws(() => parseContentType('text/plain; =x'), TypeError)
	throws(() => parseContentType('text/plain; a=b c'), TypeError)
})

// ---------------------------------------------------------------------------
// mime.ts
// ---------------------------------------------------------------------------

test('contentTypeForExtension: html appends charset', () => {
	strictEqual(contentTypeForExtension('html'), 'text/html; charset=utf-8')
})

test('contentTypeForExtension: binary extension has no charset', () => {
	strictEqual(contentTypeForExtension('png'), 'image/png')
})

test('contentTypeForExtension: unknown extension returns undefined', () => {
	strictEqual(contentTypeForExtension('zzz'), undefined)
})

test('contentTypeForExtension: uppercase extension is lowercased', () => {
	strictEqual(contentTypeForExtension('HTML'), 'text/html; charset=utf-8')
})

test('contentTypeForExtension: text/* without explicit charset defaults to UTF-8', () => {
	// text/jade has no charset entry in mimeDb -> default text/* branch
	const result = contentTypeForExtension('jade')
	ok(result?.includes('charset=utf-8'))
})

// ---------------------------------------------------------------------------
// mimeScore.ts
// ---------------------------------------------------------------------------

test('mimeScore: application/octet-stream is 0', () => {
	strictEqual(mimeScore('application/octet-stream'), 0)
})

test('mimeScore: facets are scored distinctly', () => {
	const prs = mimeScore('application/prs.foo')
	const x = mimeScore('application/x-foo')
	const vnd = mimeScore('application/vnd.foo')
	const def = mimeScore('application/foo')
	ok(prs < x && x < vnd && vnd < def)
})

test('mimeScore: source affects score (iana > default > apache > nginx)', () => {
	const iana = mimeScore('application/foo', 'iana')
	const apache = mimeScore('application/foo', 'apache')
	const def = mimeScore('application/foo', 'default')
	const nginx = mimeScore('application/foo', 'nginx')
	const unknown = mimeScore('application/foo', 'somethingelse')
	ok(iana > def && def > apache && apache > nginx)
	// unknown source falls back to the default score
	strictEqual(unknown, def)
})

test('mimeScore: type scoring (video > audio = font > application > default)', () => {
	const app = mimeScore('x/y'.replace('x', 'application'))
	const font = mimeScore('font/woff')
	const audio = mimeScore('audio/mp4')
	const video = mimeScore('video/mp4')
	const def = mimeScore('text/plain')
	ok(Number.isFinite(app) && Number.isFinite(font) && Number.isFinite(audio) && Number.isFinite(video) && Number.isFinite(def))
	ok(video > audio)
	ok(audio > app)
	ok(font > app)
	ok(app > def)
})

function req(headers: Record<string, string>) {
	return {headers} as unknown as import('node:http').IncomingMessage
}
