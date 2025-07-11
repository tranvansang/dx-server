/**
 * Parse "Range" header `str` relative to the given file `size`.
 *
 * @param {Number} size
 * @param {String} str
 * @param {Object} [options]
 * @return {Array}
 * @public
 */

export function parseRange (size, str, options) {
	if (typeof str !== 'string') {
		throw new TypeError('argument str must be a string')
	}

	const index = str.indexOf('=')

	if (index === -1) {
		return -2
	}

	// split the range string
	const arr = str.slice(index + 1).split(',')
	const ranges = []

	// add ranges type
	ranges.type = str.slice(0, index)

	// parse all ranges
	for (let i = 0; i < arr.length; i++) {
		const range = arr[i].split('-')
		let start = parseInt(range[0], 10)
		let end = parseInt(range[1], 10)

		// -nnn
		if (isNaN(start)) {
			start = size - end
			end = size - 1
			// nnn-
		} else if (isNaN(end)) {
			end = size - 1
		}

		// limit last-byte-pos to current length
		if (end > size - 1) {
			end = size - 1
		}

		// invalid or unsatisifiable
		if (isNaN(start) || isNaN(end) || start > end || start < 0) {
			continue
		}

		// add range
		ranges.push({
			start: start,
			end: end
		})
	}

	if (ranges.length < 1) {
		// unsatisifiable
		return -1
	}

	return options && options.combine
		? combineRanges(ranges)
		: ranges
}

/**
 * Combine overlapping & adjacent ranges.
 * @private
 */

function combineRanges (ranges) {
	const ordered = ranges.map(mapWithIndex).sort(sortByRangeStart)

	for (let j = 0, i = 1; i < ordered.length; i++) {
		const range = ordered[i]
		const current = ordered[j]

		if (range.start > current.end + 1) {
			// next range
			ordered[++j] = range
		} else if (range.end > current.end) {
			// extend range
			current.end = range.end
			current.index = Math.min(current.index, range.index)
		}
	}

	// trim ordered array
	ordered.length = j + 1

	// generate combined range
	const combined = ordered.sort(sortByRangeIndex).map(mapWithoutIndex)

	// copy ranges type
	combined.type = ranges.type

	return combined
}

/**
 * Map function to add index value to ranges.
 * @private
 */

function mapWithIndex (range, index) {
	return {
		start: range.start,
		end: range.end,
		index: index
	}
}

/**
 * Map function to remove index value from ranges.
 * @private
 */

function mapWithoutIndex (range) {
	return {
		start: range.start,
		end: range.end
	}
}

/**
 * Sort function to sort ranges by index.
 * @private
 */

function sortByRangeIndex (a, b) {
	return a.index - b.index
}

/**
 * Sort function to sort ranges by start position.
 * @private
 */

function sortByRangeStart (a, b) {
	return a.start - b.start
}
