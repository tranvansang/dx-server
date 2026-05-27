// 'mime-score' back-ported to CommonJS

// Score RFC facets (see https://tools.ietf.org/html/rfc6838#section-3)
const facetScores = {
	'prs.': 100,
	'x-': 200,
	'x.': 300,
	'vnd.': 400,
	default: 900,
}

// Score mime source (Logic originally from `jshttp/mime-types` module)
const sourceScores = {
	nginx: 10,
	apache: 20,
	iana: 40,
	default: 30, // definitions added by `jshttp/mime-db` project?
}

const typeScores = {
	// prefer application/xml over text/xml
	// prefer application/rtf over text/rtf
	application: 1,

	// prefer font/woff over application/font-woff
	font: 2,

	// prefer video/mp4 over audio/mp4 over application/mp4
	// See https://www.rfc-editor.org/rfc/rfc4337.html#section-2
	audio: 2,
	video: 3,

	default: 0,
}

/**
 * Get each component of the score for a mime type.  The sum of these is the
 * total score.  The higher the score, the more "official" the type.
 */
export function mimeScore(mimeType: string, source = 'default') {
	if (mimeType === 'application/octet-stream') return 0

	const [type, subtype] = mimeType.split('/')

	const facet = subtype.replace(/(\.|x-).*/, '$1')

	const facetScore = facetScores[facet as keyof typeof facetScores] || facetScores.default
	const sourceScore = sourceScores[source as keyof typeof sourceScores] || sourceScores.default
	const typeScore = typeScores[type as keyof typeof typeScores] || typeScores.default

	// All else being equal prefer shorter types
	const lengthScore = 1 - mimeType.length / 100

	return facetScore + sourceScore + typeScore + lengthScore
}
