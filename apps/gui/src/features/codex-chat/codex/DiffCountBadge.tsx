export function DiffCountBadge({ added, removed }: { added: number; removed: number }) {
	return (
		<span className="inline-flex items-center gap-1 text-[10px] font-medium">
			<span className="text-green-400">+{added}</span>
			<span className="text-red-400">-{removed}</span>
		</span>
	);
}
