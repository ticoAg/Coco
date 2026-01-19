import type { SharedArtifactCategory, SharedArtifactContent, SharedArtifactSummary } from '@/types/task';
import { TextPreview } from '@/shared/ui/TextPreview';
import { ARTIFACT_CATEGORIES } from '../../model/workbench';
import { formatEpochMs } from '../../lib/format';

interface ArtifactsTabProps {
	artifactCategory: SharedArtifactCategory;
	onSelectCategory: (category: SharedArtifactCategory) => void;
	artifacts: SharedArtifactSummary[];
	selectedArtifactPath: string | null;
	selectedArtifact: SharedArtifactSummary | null;
	artifactContent: SharedArtifactContent | null;
	artifactsLoading: boolean;
	artifactsError: string | null;
	onRefresh: () => void;
	onSelectArtifact: (path: string) => void;
}

export function ArtifactsTab({
	artifactCategory,
	onSelectCategory,
	artifacts,
	selectedArtifactPath,
	selectedArtifact,
	artifactContent,
	artifactsLoading,
	artifactsError,
	onRefresh,
	onSelectArtifact,
}: ArtifactsTabProps) {
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="text-sm font-semibold">Artifacts</div>
				<button
					type="button"
					className="rounded-md border border-white/10 bg-bg-panelHover px-3 py-2 text-sm hover:border-white/20"
					onClick={onRefresh}
				>
					Refresh
				</button>
			</div>

			<div className="flex flex-wrap gap-2">
				{ARTIFACT_CATEGORIES.map((category) => (
					<button
						key={category}
						type="button"
						className={[
							'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide',
							artifactCategory === category ? 'bg-primary/20 text-primary' : 'bg-white/10 text-text-muted hover:text-text-main',
						].join(' ')}
						onClick={() => onSelectCategory(category)}
					>
						{category}
					</button>
				))}
			</div>

			{artifactsError ? (
				<div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{artifactsError}</div>
			) : null}

			{artifactsLoading && artifacts.length === 0 ? (
				<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">Loading artifacts…</div>
			) : artifacts.length === 0 ? (
				<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">
					No artifacts in {artifactCategory}.
				</div>
			) : (
				<div className="grid grid-cols-[320px_1fr] gap-4">
					<div className="space-y-2">
						{artifacts.map((item) => {
							const isSelected = item.path === selectedArtifactPath;
							return (
								<button
									key={item.path}
									type="button"
									className={[
										'w-full rounded-lg border px-3 py-2 text-left',
										isSelected ? 'border-primary/40 bg-primary/10' : 'border-white/10 bg-bg-panelHover hover:border-white/20',
									].join(' ')}
									onClick={() => onSelectArtifact(item.path)}
								>
									<div className="truncate text-sm font-semibold">{item.filename}</div>
									<div className="mt-1 text-xs text-text-muted">updated: {formatEpochMs(item.updatedAtMs)}</div>
									{item.path !== item.filename ? <div className="mt-1 truncate text-[11px] text-text-dim">{item.path}</div> : null}
								</button>
							);
						})}
					</div>

					<div className="min-w-0 space-y-4">
						{selectedArtifactPath ? (
							<div className="rounded-lg border border-white/10 bg-bg-panelHover px-4 py-3">
								<div className="flex items-center justify-between gap-2">
									<div className="truncate text-sm font-semibold">{selectedArtifactPath}</div>
									<div className="text-xs text-text-muted">auto-refresh: 2s</div>
								</div>
								{selectedArtifact?.updatedAtMs ? (
									<div className="mt-1 text-xs text-text-muted">updated: {formatEpochMs(selectedArtifact.updatedAtMs)}</div>
								) : null}
								<div className="mt-3">
									{!artifactContent ? (
										<div className="text-sm text-text-muted">Loading…</div>
									) : (
										<TextPreview
											content={artifactContent.content}
											path={selectedArtifactPath}
											allowHtml={false}
											preClassName="max-h-[420px] overflow-auto rounded-md bg-black/20 p-3 text-xs text-text-muted"
										/>
									)}
								</div>
							</div>
						) : (
							<div className="rounded-lg border border-white/10 bg-bg-panelHover p-6 text-center text-sm text-text-muted">
								Select an artifact to preview.
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

export default ArtifactsTab;
