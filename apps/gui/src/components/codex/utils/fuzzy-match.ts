export type FuzzyMatchResult = {
	indices: number[];
	score: number;
} | null;

/**
 * 模糊匹配算法
 */
export function fuzzyMatch(pattern: string, text: string): FuzzyMatchResult {
	if (!pattern) return { indices: [], score: 0 };

	const pLower = pattern.toLowerCase();
	const tLower = text.toLowerCase();
	const indices: number[] = [];
	let pIdx = 0;
	let firstPos = -1;

	for (let i = 0; i < tLower.length && pIdx < pLower.length; i++) {
		if (tLower[i] === pLower[pIdx]) {
			if (firstPos < 0) firstPos = i;
			indices.push(i);
			pIdx++;
		}
	}

	if (pIdx < pLower.length) return null;

	let score = indices.length * 10;
	for (let i = 1; i < indices.length; i++) {
		if (indices[i] === indices[i - 1] + 1) score -= 1;
		else score += (indices[i] - indices[i - 1]) * 2;
	}

	if (firstPos === 0) score -= 100;

	return { indices, score };
}
