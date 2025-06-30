import mimeDb from './mimeDb.js'
import {mimeScore} from './mimeScore.js'

const extensionToMime = Object.create(null)

for (const [type, {extensions = []}] of Object.entries(mimeDb))
	for (const extension of extensions)
		extensionToMime[extension] = preferredType(extension, type, extensionToMime[extension])

function preferredType(ext, type0, type1) {
	const score0 = type0 ? mimeScore(type0, mimeDb[type0].source) : 0
	const score1 = type1 ? mimeScore(type1, mimeDb[type1].source) : 0

	return score0 > score1 ? type0 : type1
}

export function contentTypeForExtension(extension) {
	const mimeType = extensionToMime[extension.toLowerCase()]
	if (!mimeType) return
	if (!mimeType.includes('charset')) {
		const charset = determineCharset(mimeType)
		if (charset) return mimeType + '; charset=' + charset.toLowerCase()
	}
	return mimeType
}

const EXTRACT_TYPE_REGEXP = /^\s*([^;\s]*)(?:;|\s|$)/
const TEXT_TYPE_REGEXP = /^text\//i

function determineCharset (type) {
	// _TODO: use media-typer
	const match = EXTRACT_TYPE_REGEXP.exec(type)
	const mime = match && mimeDb[match[1].toLowerCase()]

	if (mime?.charset) return mime.charset

	// default text/* to utf-8
	if (match && TEXT_TYPE_REGEXP.test(match[1])) return 'UTF-8'
}
