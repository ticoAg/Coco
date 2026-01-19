export function formatDate(dateString: string): string {
	const date = new Date(dateString);
	return date.toLocaleString();
}

export function formatEpochMs(value: number | null): string {
	if (value == null) return '—';
	return new Date(value).toLocaleString();
}

export function formatTimeAgo(dateString: string): string {
	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return 'Just now';
	if (diffMins < 60) return String(diffMins) + 'm ago';
	if (diffHours < 24) return String(diffHours) + 'h ago';
	return String(diffDays) + 'd ago';
}
