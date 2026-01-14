export type CodeReviewLineRange = { start: number; end: number };

export type CodeReviewLocation = {
	absolute_file_path: string;
	line_range: CodeReviewLineRange;
};

export type CodeReviewFinding = {
	title: string;
	body: string;
	confidence_score: number;
	priority?: number | null;
	code_location: CodeReviewLocation;
};

export type CodeReviewStructuredOutput = {
	type: 'code-review';
	findings: CodeReviewFinding[];
	overall_correctness?: 'patch is correct' | 'patch is incorrect' | null;
	overall_explanation?: string | null;
	overall_confidence_score?: number | null;
};

export function shouldHideAssistantMessageContent(text: string): boolean {
	const trimmed = (text ?? '').trimStart();
	return trimmed.startsWith('{') || trimmed.startsWith('```');
}

export function looksLikeJsonOutput(text: string): boolean {
	const trimmed = (text ?? '').trim();
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) return true;
	const m = trimmed.match(/```(?:json)?\s*\r?\n?([\s\S]*?)```/i);
	if (m) {
		const inner = (m[1] ?? '').trim();
		return inner.startsWith('{') && inner.endsWith('}');
	}
	return false;
}

function extractJsonObjectFromAssistantMessage(text: string): string | null {
	const trimmed = (text ?? '').trim();
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

	const fenced = trimmed.match(/```(?:json)?\s*\r?\n?([\s\S]*?)```/i);
	if (fenced) {
		const inner = (fenced[1] ?? '').trim();
		if (inner.startsWith('{') && inner.endsWith('}')) return inner;
	}

	const start = trimmed.indexOf('{');
	if (start === -1) return null;

	let end = trimmed.lastIndexOf('}');
	while (end > start) {
		const candidate = trimmed.slice(start, end + 1).trim();
		if (candidate.startsWith('{') && candidate.endsWith('}')) {
			try {
				JSON.parse(candidate);
				return candidate;
			} catch {
				// try a shorter substring
			}
		}
		end = trimmed.lastIndexOf('}', end - 1);
	}

	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function parseFinding(value: unknown): CodeReviewFinding | null {
	if (!isRecord(value)) return null;
	if (typeof value.title !== 'string') return null;
	if (typeof value.body !== 'string') return null;
	if (!isNumber(value.confidence_score)) return null;

	const priority = value.priority;
	if (!(priority === undefined || priority === null || (isNumber(priority) && Number.isInteger(priority)))) {
		return null;
	}

	const codeLocation = value.code_location;
	if (!isRecord(codeLocation)) return null;
	if (typeof codeLocation.absolute_file_path !== 'string') return null;
	const lineRange = codeLocation.line_range;
	if (!isRecord(lineRange)) return null;
	if (!isNumber(lineRange.start) || !Number.isInteger(lineRange.start)) return null;
	if (!isNumber(lineRange.end) || !Number.isInteger(lineRange.end)) return null;

	return {
		title: value.title,
		body: value.body,
		confidence_score: value.confidence_score,
		priority: priority === undefined ? undefined : (priority as number | null),
		code_location: {
			absolute_file_path: codeLocation.absolute_file_path,
			line_range: { start: lineRange.start, end: lineRange.end },
		},
	};
}

export function parseCodeReviewStructuredOutputFromMessage(text: string): CodeReviewStructuredOutput | null {
	if (!looksLikeJsonOutput(text)) return null;
	const jsonText = extractJsonObjectFromAssistantMessage(text);
	if (!jsonText) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		return null;
	}

	if (!isRecord(parsed)) return null;
	const findingsRaw = parsed.findings;
	if (!Array.isArray(findingsRaw)) return null;

	const findings: CodeReviewFinding[] = [];
	for (const f of findingsRaw) {
		const finding = parseFinding(f);
		if (!finding) return null;
		findings.push(finding);
	}

	const overallCorrectness = parsed.overall_correctness;
	const overallExplanation = parsed.overall_explanation;
	const overallConfidence = parsed.overall_confidence_score;

	const normalizedOverallCorrectness =
		overallCorrectness === 'patch is correct' || overallCorrectness === 'patch is incorrect'
			? (overallCorrectness as 'patch is correct' | 'patch is incorrect')
			: overallCorrectness == null
				? null
				: null;

	const normalizedOverallExplanation = typeof overallExplanation === 'string' ? overallExplanation : overallExplanation == null ? null : null;
	const normalizedOverallConfidence = isNumber(overallConfidence) ? overallConfidence : overallConfidence == null ? null : null;

	return {
		type: 'code-review',
		findings,
		overall_correctness: normalizedOverallCorrectness,
		overall_explanation: normalizedOverallExplanation,
		overall_confidence_score: normalizedOverallConfidence,
	};
}

export function parsePriorityTagFromTitle(title: string): { tag: string; rest: string } | null {
	const m = title.match(/^\[(p\d)\]\s*(.*)$/i);
	if (!m) return null;
	const tag = (m[1] ?? '').toUpperCase();
	const rest = (m[2] ?? '').trim();
	return { tag, rest: rest || title };
}

export function isHighPriorityFinding(finding: CodeReviewFinding): boolean {
	const tag = parsePriorityTagFromTitle(finding.title)?.tag ?? '';
	return tag === 'P0' || tag === 'P1';
}
