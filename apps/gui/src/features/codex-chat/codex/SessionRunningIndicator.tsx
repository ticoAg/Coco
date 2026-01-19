export function SessionRunningIndicator({ className }: { className?: string }) {
	return (
		<svg className={['h-3 w-3 animate-spin', className].filter(Boolean).join(' ')} viewBox="0 0 32 32" aria-label="Running">
			<circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/20" />
			<circle
				cx="16"
				cy="16"
				r="14"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeDasharray="22 66"
				strokeLinecap="round"
				className="text-status-info/70"
			/>
		</svg>
	);
}
