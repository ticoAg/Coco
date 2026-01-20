import type { TaskState } from '@/types/task';

function statusBadgeStyle(state: TaskState): {
	label: string;
	className: string;
} {
	switch (state) {
		case 'working':
			return {
				label: 'WORKING',
				className: 'bg-status-info/15 text-status-info',
			};
		case 'input-required':
			return {
				label: 'BLOCKED',
				className: 'bg-status-warning/15 text-status-warning',
			};
		case 'completed':
			return {
				label: 'DONE',
				className: 'bg-status-success/15 text-status-success',
			};
		case 'failed':
			return {
				label: 'FAILED',
				className: 'bg-status-error/15 text-status-error',
			};
		case 'canceled':
			return { label: 'CANCELED', className: 'bg-white/10 text-text-muted' };
		case 'created':
		default:
			return { label: 'CREATED', className: 'bg-white/10 text-text-muted' };
	}
}

export function StatusBadge({ state }: { state: TaskState }) {
	const config = statusBadgeStyle(state);
	return <span className={'inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold tracking-wide ' + config.className}>{config.label}</span>;
}

export default StatusBadge;
