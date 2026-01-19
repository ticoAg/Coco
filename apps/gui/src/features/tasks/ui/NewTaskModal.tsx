import { useEffect, useMemo, useRef, useState } from 'react';
import type { CreateTaskRequest, TaskTopology } from '@/types/task';

interface NewTaskModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSubmit: (data: CreateTaskRequest) => Promise<void>;
	loading?: boolean;
}

interface RosterRow {
	id: string;
	instance: string;
	agent: string;
}

export function NewTaskModal({ isOpen, onClose, onSubmit, loading = false }: NewTaskModalProps) {
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [topology, setTopology] = useState<TaskTopology>('swarm');
	const [roster, setRoster] = useState<RosterRow[]>([]);
	const [error, setError] = useState<string | null>(null);

	const titleInputRef = useRef<HTMLInputElement>(null);
	const modalRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (isOpen) titleInputRef.current?.focus();
	}, [isOpen]);

	useEffect(() => {
		const onEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && isOpen) onClose();
		};
		document.addEventListener('keydown', onEscape);
		return () => document.removeEventListener('keydown', onEscape);
	}, [isOpen, onClose]);

	useEffect(() => {
		if (!isOpen) {
			setTitle('');
			setDescription('');
			setTopology('swarm');
			setRoster([]);
			setError(null);
		}
	}, [isOpen]);

	const canSubmit = useMemo(() => title.trim().length > 0, [title]);

	const addRosterRow = () => {
		setRoster((prev) => [...prev, { id: crypto.randomUUID(), instance: '', agent: '' }]);
	};

	const removeRosterRow = (id: string) => {
		setRoster((prev) => prev.filter((r) => r.id !== id));
	};

	const updateRosterRow = (id: string, field: 'instance' | 'agent', value: string) => {
		setRoster((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
	};

	const handleBackdropClick = (e: React.MouseEvent) => {
		if (e.target === modalRef.current) onClose();
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSubmit) {
			setError('Task title is required');
			return;
		}

		const data: CreateTaskRequest = {
			title: title.trim(),
			description: description.trim() || undefined,
			topology,
			roster: roster.map((r) => ({ instance: r.instance.trim(), agent: r.agent.trim() })).filter((r) => r.instance && r.agent),
		};

		setError(null);
		try {
			await onSubmit(data);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create task');
		}
	};

	if (!isOpen) return null;

	return (
		<div ref={modalRef} onClick={handleBackdropClick} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
			<div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-bg-popover p-6">
				<div className="mb-5 flex items-start justify-between gap-4">
					<div>
						<h2 className="text-lg font-semibold">Create Task</h2>
						<p className="mt-1 text-sm text-text-muted">Creates a new `.coco/tasks/*` entry.</p>
					</div>
					<button
						type="button"
						className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-sm hover:border-white/20"
						onClick={onClose}
						disabled={loading}
					>
						✕
					</button>
				</div>

				{error ? <div className="mb-4 rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{error}</div> : null}

				<form onSubmit={handleSubmit} className="space-y-5">
					<div className="space-y-2">
						<label className="text-sm font-medium">Title *</label>
						<input
							ref={titleInputRef}
							className="w-full rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2 text-sm outline-none focus:border-border-active"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="e.g. Investigate login latency"
							disabled={loading}
						/>
					</div>

					<div className="space-y-2">
						<label className="text-sm font-medium">Description</label>
						<textarea
							className="w-full rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2 text-sm outline-none focus:border-border-active"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={3}
							placeholder="What should this task produce?"
							disabled={loading}
						/>
					</div>

					<div className="space-y-2">
						<label className="text-sm font-medium">Topology</label>
						<div className="grid grid-cols-2 gap-3">
							{(['swarm', 'squad'] as TaskTopology[]).map((value) => (
								<button
									key={value}
									type="button"
									className={[
										'rounded-lg border px-3 py-3 text-left text-sm transition',
										topology === value ? 'border-border-active bg-primary/10' : 'border-white/10 bg-bg-panelHover hover:border-white/20',
									].join(' ')}
									onClick={() => setTopology(value)}
									disabled={loading}
								>
									<div className="font-semibold">{value}</div>
									<div className="mt-1 text-xs text-text-muted">
										{value === 'swarm' ? 'Parallel diagnostics / fork-join' : 'Milestone-driven squad workflow'}
									</div>
								</button>
							))}
						</div>
					</div>

					<div className="space-y-2">
						<div className="flex items-center justify-between gap-3">
							<label className="text-sm font-medium">Roster (optional)</label>
							<button
								type="button"
								className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-1.5 text-sm hover:border-white/20"
								onClick={addRosterRow}
								disabled={loading}
							>
								+ Add
							</button>
						</div>

						{roster.length ? (
							<div className="space-y-2">
								{roster.map((row, idx) => (
									<div key={row.id} className="grid grid-cols-[32px_1fr_1fr_40px] items-center gap-2">
										<div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{idx + 1}</div>
										<input
											className="rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2 text-sm outline-none focus:border-border-active"
											value={row.instance}
											onChange={(e) => updateRosterRow(row.id, 'instance', e.target.value)}
											placeholder="instance (e.g. backend-1)"
											disabled={loading}
										/>
										<input
											className="rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2 text-sm outline-none focus:border-border-active"
											value={row.agent}
											onChange={(e) => updateRosterRow(row.id, 'agent', e.target.value)}
											placeholder="agent (e.g. backend)"
											disabled={loading}
										/>
										<button
											type="button"
											className="rounded-md border border-white/10 bg-bg-panelHover px-2 py-2 text-sm hover:border-white/20"
											onClick={() => removeRosterRow(row.id)}
											disabled={loading}
											title="Remove"
										>
											✕
										</button>
									</div>
								))}
							</div>
						) : (
							<div className="rounded-lg border border-white/10 bg-bg-panelHover p-3 text-sm text-text-muted">No roster entries yet.</div>
						)}
					</div>

					<div className="flex items-center justify-end gap-3 pt-2">
						<button
							type="button"
							className="rounded-md border border-white/10 bg-bg-panelHover px-4 py-2 text-sm hover:border-white/20"
							onClick={onClose}
							disabled={loading}
						>
							Cancel
						</button>
						<button
							type="submit"
							className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
							disabled={loading || !canSubmit}
						>
							{loading ? 'Creating…' : 'Create'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

export default NewTaskModal;
