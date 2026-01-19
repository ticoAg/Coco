import { Box, ChevronDown, ChevronRight, Folder, Info, RotateCw, Settings } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { MENU_STYLES } from '../codex/styles/menu-styles';
import { repoNameFromPath } from '../lib/parsing';

type Props = {
	activeThreadCwd: string | null;
	workspaceRoot: string | null;
	recentWorkspaces: string[];
	isWorkspaceMenuOpen: boolean;
	setIsWorkspaceMenuOpen: Dispatch<SetStateAction<boolean>>;
	isSettingsMenuOpen: boolean;
	setIsSettingsMenuOpen: Dispatch<SetStateAction<boolean>>;
	relatedRepoPaths: string[];
	selectedThreadId: string | null;
	canAddRelatedRepoDir: boolean;
	onAddRelatedRepoDir: () => void;
	onRemoveRelatedRepoDir: (path: string) => void;
	openNewWindow: () => void;
	openWorkspaceDialog: () => void;
	applyWorkspaceRoot: (path: string) => void;
	showAbout: () => void;
	showUpdates: () => void;
	openSettings: () => void;
	openConfig: () => void;
};

export function CodexChatHeader({
	activeThreadCwd,
	workspaceRoot,
	recentWorkspaces,
	isWorkspaceMenuOpen,
	setIsWorkspaceMenuOpen,
	isSettingsMenuOpen,
	setIsSettingsMenuOpen,
	relatedRepoPaths,
	selectedThreadId,
	canAddRelatedRepoDir,
	onAddRelatedRepoDir,
	onRemoveRelatedRepoDir,
	openNewWindow,
	openWorkspaceDialog,
	applyWorkspaceRoot,
	showAbout,
	showUpdates,
	openSettings,
	openConfig,
}: Props) {
	const currentWorkspace = activeThreadCwd ?? workspaceRoot ?? '';
	const currentWorkspaceLabel = currentWorkspace ? repoNameFromPath(currentWorkspace) : 'Select Project';
	const recentEntries = recentWorkspaces.filter((p) => p !== currentWorkspace).slice(0, 5);

	return (
		<div className="flex h-10 shrink-0 items-center border-b border-white/10 bg-bg-panel/60" data-tauri-drag-region>
			{/* macOS window controls placeholder */}
			<div className="w-20 shrink-0" data-tauri-drag-region />

			<div className="flex min-w-0 items-center gap-2">
				{/* Workspace dropdown */}
				<div className="relative shrink-0">
					<button
						type="button"
						className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-menuDivider bg-bg-panel/40 px-2.5 text-[13px] font-medium text-text-main hover:bg-bg-panelHover transition-colors"
						onClick={() => setIsWorkspaceMenuOpen((v) => !v)}
						title={currentWorkspace}
					>
						<span className="truncate">{currentWorkspaceLabel}</span>
						<ChevronDown className="h-4 w-4 text-text-menuLabel" />
					</button>

					{isWorkspaceMenuOpen ? (
						<>
							<div className="fixed inset-0 z-40" onClick={() => setIsWorkspaceMenuOpen(false)} role="button" tabIndex={0} />
							<div className={`absolute left-0 top-full z-50 mt-2 w-[260px] p-1.5 ${MENU_STYLES.popover}`}>
								<div className={MENU_STYLES.popoverTitle}>Current Project</div>
								<button
									type="button"
									className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-bg-menuItemHover transition-colors"
									title={currentWorkspace}
								>
									<div className="flex min-w-0 items-center gap-2">
										<Folder className="h-4 w-4 shrink-0 text-text-menuLabel" />
										<div className="min-w-0">
											<div className="truncate text-[12px] font-medium text-text-main">{currentWorkspaceLabel || 'Not set'}</div>
											<div className="truncate text-[11px] text-text-menuDesc">
												{currentWorkspace ? `~${currentWorkspace.replace(/^\/Users\/[^/]+/, '')}` : 'No project selected'}
											</div>
										</div>
									</div>
									<ChevronRight className="h-4 w-4 shrink-0 text-text-menuLabel" />
								</button>

								<div className="mx-2 my-1.5 border-t border-border-menuDivider" />

								<button type="button" className={MENU_STYLES.popoverItem} onClick={openNewWindow}>
									<Box className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
									<span>New Window</span>
								</button>

								<button type="button" className={MENU_STYLES.popoverItem} onClick={openWorkspaceDialog}>
									<Folder className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
									<span>Open Project</span>
								</button>

								{recentEntries.length > 0 ? (
									<>
										<div className="mx-2 my-1.5 border-t border-border-menuDivider" />
										<div className={MENU_STYLES.popoverTitle}>Recent Projects</div>
										<div>
											{recentEntries.map((path) => (
												<button
													key={path}
													type="button"
													className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-bg-menuItemHover transition-colors"
													onClick={() => applyWorkspaceRoot(path)}
													title={path}
												>
													<Folder className="h-4 w-4 shrink-0 text-text-menuLabel" />
													<div className="min-w-0">
														<div className="truncate text-[12px] font-medium text-text-main">{repoNameFromPath(path)}</div>
														<div className="truncate text-[11px] text-text-menuDesc">{`~${path.replace(/^\/Users\/[^/]+/, '')}`}</div>
													</div>
												</button>
											))}
										</div>
									</>
								) : null}

								<div className="mx-2 my-1.5 border-t border-border-menuDivider" />

								<button type="button" className={MENU_STYLES.popoverItem} onClick={showAbout}>
									<Info className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
									<span>About AgentMesh</span>
								</button>

								<button type="button" className={MENU_STYLES.popoverItem} onClick={showUpdates}>
									<RotateCw className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
									<span>Check for Updates...</span>
								</button>
							</div>
						</>
					) : null}
				</div>

				{activeThreadCwd && relatedRepoPaths.length > 0 ? (
					<div className="flex min-w-0 flex-nowrap items-center gap-1.5">
						{relatedRepoPaths.map((path) => (
							<div
								key={path}
								className="group inline-flex h-7 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 text-[11px] leading-none text-text-main"
								title={path}
							>
								<span className="max-w-[140px] truncate">{repoNameFromPath(path)}</span>
								<button
									type="button"
									className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-red-300 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto hover:bg-red-500/70 hover:text-white"
									onClick={() => onRemoveRelatedRepoDir(path)}
									aria-label={`Remove related repo ${repoNameFromPath(path)}`}
								>
									-
								</button>
							</div>
						))}
					</div>
				) : null}

				{selectedThreadId && activeThreadCwd && canAddRelatedRepoDir ? (
					<button
						type="button"
						className="inline-flex h-7 items-center rounded px-2 text-[11px] leading-none text-text-muted hover:bg-white/5 hover:text-text-main"
						onClick={onAddRelatedRepoDir}
						title="Add related dir"
					>
						+ add dir
					</button>
				) : null}
			</div>

			<div className="flex-1" data-tauri-drag-region />

			<div className="relative mr-3 flex shrink-0 items-center gap-1.5">
				<button
					type="button"
					className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-menuDivider bg-bg-panel/40 text-text-main hover:bg-bg-panelHover transition-colors"
					onClick={() => setIsSettingsMenuOpen((v) => !v)}
					title="Menu"
				>
					<Settings className="h-5 w-5" />
				</button>

				{isSettingsMenuOpen ? (
					<>
						<div className="fixed inset-0 z-40" onClick={() => setIsSettingsMenuOpen(false)} role="button" tabIndex={0} />
						<div className={`absolute right-0 top-[44px] z-50 w-[220px] p-1.5 ${MENU_STYLES.popover}`}>
							<div className={MENU_STYLES.popoverTitle}>Menu</div>
							<button
								type="button"
								className={MENU_STYLES.popoverItem}
								onClick={() => {
									setIsSettingsMenuOpen(false);
									openSettings();
								}}
							>
								Settings
							</button>
							<button
								type="button"
								className={MENU_STYLES.popoverItem}
								onClick={() => {
									setIsSettingsMenuOpen(false);
									openConfig();
								}}
							>
								Edit config.toml
							</button>
						</div>
					</>
				) : null}
			</div>
		</div>
	);
}
