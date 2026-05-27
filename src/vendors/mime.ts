import mimeDbRaw from './mimeDb.js'
import {mimeScore} from './mimeScore.js'

const mimeDb: Record<
	string,
	{
		source?: string
		charset?: string
		compressible?: boolean
		extensions?: string[]
	}
> = mimeDbRaw

const extensionToMime: Record<string, string | undefined> = Object.create(null)

for (const [type, {extensions = []}] of Object.entries(mimeDb))
	for (const extension of extensions)
		extensionToMime[extension] = preferredType(extension, type, extensionToMime[extension])

function preferredType(ext: string, type0?: string, type1?: string) {
	const score0 = type0 ? mimeScore(type0, mimeDb[type0].source) : 0
	const score1 = type1 ? mimeScore(type1, mimeDb[type1].source) : 0

	return score0 > score1 ? type0 : type1
}

export function contentTypeForExtension(extension: string) {
	const mimeType = extensionToMime[extension.toLowerCase()]
	if (!mimeType) return
	if (!mimeType.includes('charset')) {
		const charset = determineCharset(mimeType)
		if (charset) return mimeType + '; charset=' + charset.toLowerCase()
	}
	return mimeType
}

const extractTypeRegexp = /^\s*([^;\s]*)(?:;|\s|$)/
const textTypeRegexp = /^text\//i

function determineCharset(type: string) {
	// _TODO: use media-typer
	const match = extractTypeRegexp.exec(type)
	const mime = match && mimeDb[match[1].toLowerCase()]

	if (mime?.charset) return mime.charset

	// default text/* to utf-8
	if (match && textTypeRegexp.test(match[1])) return 'UTF-8'
}
