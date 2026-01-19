export function formatTokenCount(value: number): string {
	if (!Number.isFinite(value)) return '—';
	const abs = Math.abs(value);
	if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
	if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
	return String(Math.round(value));
}

export function errorMessage(err: unknown, fallback: string): string {
	if (err instanceof Error) return err.message || fallback;
	if (typeof err === 'string') return err || fallback;
	try {
		return JSON.stringify(err);
	} catch {
		return fallback;
	}
}

export function safeString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
