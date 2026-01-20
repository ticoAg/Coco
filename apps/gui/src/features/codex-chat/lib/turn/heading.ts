export function extractHeadingFromMarkdown(text: string): { heading: string | null; body: string } {
	if (!text) return { heading: null, body: '' };

	const lines = text.split('\n');
	let firstIdx = 0;
	while (firstIdx < lines.length && lines[firstIdx]?.trim() === '') {
		firstIdx += 1;
	}
	const firstLine = lines[firstIdx]?.trim() || '';
	const secondLine = lines[firstIdx + 1]?.trim() || '';

	// Check for markdown heading: # Heading
	if (firstLine.startsWith('#')) {
		const heading = firstLine.replace(/^#+\s*/, '').trim();
		const body = lines
			.slice(firstIdx + 1)
			.join('\n')
			.trim();
		return { heading: heading || null, body };
	}

	// Check for bold heading: **Heading**
	const boldMatch = firstLine.match(/^\*\*(.+)\*\*$/);
	if (boldMatch) {
		const heading = boldMatch[1].trim();
		const body = lines
			.slice(firstIdx + 1)
			.join('\n')
			.trim();
		return { heading: heading || null, body };
	}

	// Check for setext-style heading
	if (firstLine && (secondLine.match(/^=+$/) || secondLine.match(/^-+$/))) {
		const heading = firstLine.trim();
		const body = lines
			.slice(firstIdx + 2)
			.join('\n')
			.trim();
		return { heading: heading || null, body };
	}

	return { heading: null, body: text };
}
