import { ArrowUp, File, FileText, Folder, Image, Plus, X, Zap } from 'lucide-react';
import type { ChangeEvent, ClipboardEvent, Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import type { AutoContextInfo, CustomPrompt, FileAttachment, FileInfo, SkillMetadata } from '@/types/codex';
import type { SlashCommand } from '../codex/slash-commands';
import { MENU_STYLES } from '../codex/styles/menu-styles';
import { SkillMenu } from '../codex/SkillMenu';
import { SlashCommandMenu } from '../codex/SlashCommandMenu';

function ShortSlashIcon({ className }: { className?: string }) {
	// Keep icon size the same (h-4 w-4), but shorten the slash stroke to 70% of lucide's default
	// and rotate it slightly counter-clockwise so it doesn't visually "touch" the container.
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden="true"
			focusable="false"
		>
			<g transform="rotate(-10 12 12)">
				<path d="M19 5 5 19" />
			</g>
		</svg>
	);
}

type FilteredSlashCommand = { cmd: SlashCommand; indices: number[] | null };
type FilteredPrompt = { prompt: CustomPrompt; indices: number[] | null };
type FilteredSkill = { skill: SkillMetadata; indices: number[] | null };

type PinnedResolvedItem = { type: 'prompt'; prompt: CustomPrompt } | { type: 'skill'; skill: SkillMetadata };

type Props = {
	pinnedResolvedItems: PinnedResolvedItem[];
	executePromptSelection: (prompt: CustomPrompt) => void;
	executeSkillSelection: (skill: SkillMetadata) => void;
	executeSlashCommand: (commandId: string) => void;
	togglePinnedPromptName: (promptName: string) => void;
	togglePinnedSkillName: (skillName: string) => void;
	pinnedPromptNames: Set<string>;
	pinnedSkillNames: Set<string>;

	isSlashMenuOpen: boolean;
	isAddContextOpen: boolean;
	isSkillMenuOpen: boolean;
	setIsSlashMenuOpen: Dispatch<SetStateAction<boolean>>;
	setIsAddContextOpen: Dispatch<SetStateAction<boolean>>;
	setIsSkillMenuOpen: Dispatch<SetStateAction<boolean>>;

	slashSearchQuery: string;
	skillSearchQuery: string;
	fileSearchQuery: string;
	setSlashSearchQuery: Dispatch<SetStateAction<string>>;
	setSkillSearchQuery: Dispatch<SetStateAction<string>>;
	setFileSearchQuery: Dispatch<SetStateAction<string>>;

	slashHighlightIndex: number;
	skillHighlightIndex: number;
	setSlashHighlightIndex: Dispatch<SetStateAction<number>>;
	setSkillHighlightIndex: Dispatch<SetStateAction<number>>;
	slashMenuTotalItems: number;

	filteredSlashCommands: FilteredSlashCommand[];
	filteredPromptsForSlashMenu: FilteredPrompt[];
	filteredSkillsForSlashMenu: FilteredSkill[];
	skills: SkillMetadata[];
	filteredSkills: FilteredSkill[];

	fileSearchResults: FileInfo[];
	setFileSearchResults: Dispatch<SetStateAction<FileInfo[]>>;
	searchFiles: (query: string) => Promise<void>;
	addFileAttachment: (file: FileInfo) => Promise<void>;

	fileAttachments: FileAttachment[];
	removeFileAttachment: (id: string) => void;
	handleImageUpload: (ev: ChangeEvent<HTMLInputElement>) => void;
	fileInputRef: RefObject<HTMLInputElement>;

	selectedPrompt: CustomPrompt | null;
	selectedSkill: SkillMetadata | null;

	input: string;
	setInput: Dispatch<SetStateAction<string>>;
	textareaRef: RefObject<HTMLTextAreaElement>;
	menuListRef: RefObject<HTMLDivElement>;
	handleTextareaPaste: (ev: ClipboardEvent<HTMLTextAreaElement>) => void;
	handleTextareaKeyDown: (ev: KeyboardEvent<HTMLTextAreaElement>) => void;

	sending: boolean;
	autoContextEnabled: boolean;
	setAutoContextEnabled: Dispatch<SetStateAction<boolean>>;
	autoContext: AutoContextInfo | null;

	activeTurnId: string | null;
	selectedThreadId: string | null;
	stopTurn: () => void;
	sendMessage: () => Promise<void>;
};

export function CodexChatComposer({
	pinnedResolvedItems,
	executePromptSelection,
	executeSkillSelection,
	executeSlashCommand,
	togglePinnedPromptName,
	togglePinnedSkillName,
	pinnedPromptNames,
	pinnedSkillNames,

	isSlashMenuOpen,
	isAddContextOpen,
	isSkillMenuOpen,
	setIsSlashMenuOpen,
	setIsAddContextOpen,
	setIsSkillMenuOpen,

	slashSearchQuery,
	skillSearchQuery,
	fileSearchQuery,
	setSlashSearchQuery,
	setSkillSearchQuery,
	setFileSearchQuery,

	slashHighlightIndex,
	skillHighlightIndex,
	setSlashHighlightIndex,
	setSkillHighlightIndex,
	slashMenuTotalItems,

	filteredSlashCommands,
	filteredPromptsForSlashMenu,
	filteredSkillsForSlashMenu,
	skills,
	filteredSkills,

	fileSearchResults,
	setFileSearchResults,
	searchFiles,
	addFileAttachment,

	fileAttachments,
	removeFileAttachment,
	handleImageUpload,
	fileInputRef,

	selectedPrompt,
	selectedSkill,

	input,
	setInput,
	textareaRef,
	menuListRef,
	handleTextareaPaste,
	handleTextareaKeyDown,

	sending,
	autoContextEnabled,
	setAutoContextEnabled,
	autoContext,

	activeTurnId,
	selectedThreadId,
	stopTurn,
	sendMessage,
}: Props) {
	return (
		<div className="group relative mt-4 flex flex-col gap-2 rounded-[26px] border border-white/5 bg-[#2b2d31] px-4 py-3 transition-colors focus-within:border-white/10">
			{/* Floating pinned prompt/skill shortcuts (shown while composer is focused) */}
			{pinnedResolvedItems.length > 0 ? (
				<div className="pointer-events-none absolute bottom-full left-0 right-0 z-30 mb-2 flex flex-wrap gap-1.5 px-4 opacity-0 translate-y-2 transition-all duration-150 ease-out group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-y-0">
					{pinnedResolvedItems.map((item) =>
						item.type === 'prompt' ? (
							<button
								key={`prompt:${item.prompt.name}`}
								type="button"
								className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-[11px] text-text-muted hover:bg-white/10 hover:text-text-main"
								onClick={() => executePromptSelection(item.prompt)}
								title={`prompts:${item.prompt.name}`}
							>
								<FileText className="h-3 w-3 text-text-menuLabel" />
								<span className="max-w-[200px] truncate">{`prompts:${item.prompt.name}`}</span>
							</button>
						) : (
							<button
								key={`skill:${item.skill.name}`}
								type="button"
								className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-[11px] text-text-muted hover:bg-white/10 hover:text-text-main"
								onClick={() => executeSkillSelection(item.skill)}
								title={item.skill.name}
							>
								<Zap className="h-3 w-3 text-text-menuLabel" />
								<span className="max-w-[200px] truncate">{item.skill.name}</span>
							</button>
						)
					)}
				</div>
			) : null}

			{/* Popup Menu - shared container for +, / and $ menus */}
			{isSlashMenuOpen || isAddContextOpen || isSkillMenuOpen ? (
				<>
					<div
						className="fixed inset-0 z-40"
						onClick={() => {
							if (isSlashMenuOpen) {
								setIsSlashMenuOpen(false);
								setSlashSearchQuery('');
								setSlashHighlightIndex(0);
							}
							if (isAddContextOpen) {
								setIsAddContextOpen(false);
								setFileSearchQuery('');
								setFileSearchResults([]);
							}
							if (isSkillMenuOpen) {
								setIsSkillMenuOpen(false);
								setSkillSearchQuery('');
								setSkillHighlightIndex(0);
							}
						}}
						role="button"
						tabIndex={0}
					/>
					<div className={`${MENU_STYLES.popoverPosition} ${MENU_STYLES.popover}`}>
						{/* Search input */}
						<input
							type="text"
							className={`mb-2 ${MENU_STYLES.searchInput}`}
							placeholder={isSlashMenuOpen ? 'Search commands...' : isSkillMenuOpen ? 'Search skills...' : 'Search files...'}
							value={isSlashMenuOpen ? slashSearchQuery : isSkillMenuOpen ? skillSearchQuery : fileSearchQuery}
							onChange={(e) => {
								if (isSlashMenuOpen) {
									setSlashSearchQuery(e.target.value);
									setSlashHighlightIndex(0);
								} else if (isSkillMenuOpen) {
									setSkillSearchQuery(e.target.value);
									setSkillHighlightIndex(0);
								} else {
									void searchFiles(e.target.value);
								}
							}}
							onKeyDown={(e) => {
								// Arrow navigation
								if (e.key === 'ArrowDown') {
									e.preventDefault();
									if (isSlashMenuOpen) {
										setSlashHighlightIndex((i) => Math.min(i + 1, slashMenuTotalItems - 1));
									} else if (isSkillMenuOpen) {
										setSkillHighlightIndex((i) => Math.min(i + 1, filteredSkills.length - 1));
									}
									return;
								}
								if (e.key === 'ArrowUp') {
									e.preventDefault();
									if (isSlashMenuOpen) {
										setSlashHighlightIndex((i) => Math.max(i - 1, 0));
									} else if (isSkillMenuOpen) {
										setSkillHighlightIndex((i) => Math.max(i - 1, 0));
									}
									return;
								}
								// Tab completion
								if (e.key === 'Tab') {
									e.preventDefault();
									if (isSlashMenuOpen) {
										if (slashHighlightIndex < filteredSlashCommands.length) {
											const selected = filteredSlashCommands[slashHighlightIndex];
											if (selected) {
												setInput(`/${selected.cmd.id} `);
												setIsSlashMenuOpen(false);
												setSlashSearchQuery('');
												textareaRef.current?.focus();
											}
										} else if (slashHighlightIndex < filteredSlashCommands.length + filteredPromptsForSlashMenu.length) {
											const promptIdx = slashHighlightIndex - filteredSlashCommands.length;
											const selected = filteredPromptsForSlashMenu[promptIdx];
											if (selected) {
												executePromptSelection(selected.prompt);
											}
										} else {
											const skillIdx = slashHighlightIndex - filteredSlashCommands.length - filteredPromptsForSlashMenu.length;
											const selected = filteredSkillsForSlashMenu[skillIdx];
											if (selected) {
												executeSkillSelection(selected.skill);
											}
										}
									} else if (isSkillMenuOpen) {
										const selected = filteredSkills[skillHighlightIndex];
										if (selected) {
											executeSkillSelection(selected.skill);
										}
									}
									return;
								}
								// Enter to select
								if (e.key === 'Enter') {
									e.preventDefault();
									if (isSlashMenuOpen) {
										if (slashHighlightIndex < filteredSlashCommands.length) {
											const selected = filteredSlashCommands[slashHighlightIndex];
											if (selected) executeSlashCommand(selected.cmd.id);
										} else if (slashHighlightIndex < filteredSlashCommands.length + filteredPromptsForSlashMenu.length) {
											const promptIdx = slashHighlightIndex - filteredSlashCommands.length;
											const selected = filteredPromptsForSlashMenu[promptIdx];
											if (selected) {
												executePromptSelection(selected.prompt);
											}
										} else {
											const skillIdx = slashHighlightIndex - filteredSlashCommands.length - filteredPromptsForSlashMenu.length;
											const selected = filteredSkillsForSlashMenu[skillIdx];
											if (selected) {
												executeSkillSelection(selected.skill);
											}
										}
									} else if (isSkillMenuOpen) {
										const selected = filteredSkills[skillHighlightIndex];
										if (selected) executeSkillSelection(selected.skill);
									}
									return;
								}
								// Escape closes menu
								if (e.key === 'Escape') {
									e.preventDefault();
									if (isSlashMenuOpen) {
										setIsSlashMenuOpen(false);
										setSlashSearchQuery('');
									} else if (isSkillMenuOpen) {
										setIsSkillMenuOpen(false);
										setSkillSearchQuery('');
									} else if (isAddContextOpen) {
										setIsAddContextOpen(false);
										setFileSearchQuery('');
										setFileSearchResults([]);
									}
									textareaRef.current?.focus();
								}
							}}
							autoFocus
						/>

						{/* Content list */}
						<div ref={menuListRef} className={MENU_STYLES.listContainer}>
							{isSkillMenuOpen ? (
								<SkillMenu
									skills={skills}
									filteredSkills={filteredSkills}
									highlightIndex={skillHighlightIndex}
									onHighlight={setSkillHighlightIndex}
									onSelect={executeSkillSelection}
								/>
							) : isSlashMenuOpen ? (
								<SlashCommandMenu
									filteredCommands={filteredSlashCommands}
									filteredPrompts={filteredPromptsForSlashMenu}
									filteredSkills={filteredSkillsForSlashMenu}
									pinnedPromptNames={pinnedPromptNames}
									pinnedSkillNames={pinnedSkillNames}
									highlightIndex={slashHighlightIndex}
									onHighlight={setSlashHighlightIndex}
									onSelectCommand={executeSlashCommand}
									onSelectPrompt={executePromptSelection}
									onSelectSkill={executeSkillSelection}
									onTogglePromptPin={togglePinnedPromptName}
									onToggleSkillPin={togglePinnedSkillName}
								/>
							) : (
								<>
									{fileSearchResults.length > 0 ? (
										fileSearchResults.map((f) => (
											<button key={f.path} type="button" className={MENU_STYLES.popoverItem} onClick={() => void addFileAttachment(f)}>
												{f.isDirectory ? (
													<Folder className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
												) : (
													<File className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
												)}
												<span className="truncate">{f.path}</span>
											</button>
										))
									) : fileSearchQuery ? (
										<div className={`${MENU_STYLES.popoverItemDesc} px-2 py-1`}>No files found</div>
									) : null}
								</>
							)}
						</div>

						{/* Add image option (only for + menu) */}
						{isAddContextOpen ? (
							<div className="mt-1.5 border-t border-border-menuDivider pt-1.5">
								<button type="button" className={MENU_STYLES.popoverItem} onClick={() => fileInputRef.current?.click()}>
									<Image className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
									<span>Add image</span>
								</button>
							</div>
						) : null}
					</div>
				</>
			) : null}

			{/* Attachments display (skill/prompt tags are inline with textarea) */}
			{fileAttachments.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{fileAttachments.map((f) => (
						<div key={f.id} className="inline-flex items-center gap-1.5 rounded-md bg-black/20 px-2 py-1 text-[11px]">
							{f.kind === 'image' || f.kind === 'localImage' ? <Image className="h-3 w-3 text-text-dim" /> : <File className="h-3 w-3 text-text-dim" />}
							<span className="max-w-[120px] truncate">{f.name}</span>
							<button type="button" className="rounded p-0.5 hover:bg-white/10" onClick={() => removeFileAttachment(f.id)}>
								<X className="h-3 w-3" />
							</button>
						</div>
					))}
				</div>
			) : null}

			{/* Hidden file input for image upload */}
			<input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />

			{/* Input area with inline tags for skill/prompt */}
			<div className="flex flex-wrap items-start gap-1.5">
				{selectedPrompt ? (
					<div className="inline-flex shrink-0 items-center gap-1.5 rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-400">
						<FileText className="h-3 w-3" />
						<span className="max-w-[160px] truncate">prompts:{selectedPrompt.name}</span>
					</div>
				) : null}
				{selectedSkill ? (
					<div className="inline-flex shrink-0 items-center gap-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
						<Zap className="h-3 w-3" />
						<span className="max-w-[160px] truncate">{selectedSkill.name}</span>
					</div>
				) : null}
				<textarea
					ref={textareaRef}
					rows={1}
					className="m-0 h-5 min-w-[100px] flex-1 resize-none overflow-y-auto bg-transparent p-0 text-[13px] leading-5 outline-none placeholder:text-text-muted/40"
					placeholder={selectedSkill || selectedPrompt ? '' : 'Ask for follow-up changes'}
					value={input}
					onChange={(e) => {
						const newValue = e.target.value;
						setInput(newValue);

						// Auto-resize textarea
						const textarea = e.target;
						textarea.style.height = 'auto';
						textarea.style.height = `${Math.min(textarea.scrollHeight, 264)}px`;
					}}
					onPaste={handleTextareaPaste}
					onKeyDown={handleTextareaKeyDown}
					disabled={sending}
				/>
			</div>

			{/* Toolbar: + / AutoContext Send */}
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1">
					<button
						type="button"
						className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted hover:bg-white/10 hover:text-text-main"
						title="Add context (+)"
						onClick={() => setIsAddContextOpen((v) => !v)}
					>
						<Plus className="h-4 w-4" />
					</button>

					<button
						type="button"
						className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted hover:bg-white/10 hover:text-text-main"
						title="Commands (/)"
						onClick={() => setIsSlashMenuOpen((v) => !v)}
					>
						<ShortSlashIcon className="h-4 w-4" />
					</button>

					<button
						type="button"
						className={[
							'ml-2 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] leading-none transition-colors',
							autoContextEnabled ? 'bg-blue-600/30 text-blue-300' : 'text-text-muted hover:bg-white/10',
						].join(' ')}
						onClick={() => setAutoContextEnabled((v) => !v)}
						title={
							autoContext
								? `cwd: ${autoContext.cwd}\nRecent: ${autoContext.recentFiles.length} files\nGit: ${autoContext.gitStatus?.branch ?? 'N/A'}`
								: 'Auto context'
						}
					>
						<span className={autoContextEnabled ? 'text-blue-400' : 'text-text-muted'}>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M13 10V3L4 14H11V21L20 10H13Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</span>
						<span>Auto context</span>
					</button>
				</div>

				{activeTurnId && selectedThreadId ? (
					<button
						type="button"
						className="group flex h-7 w-7 items-center justify-center rounded-full bg-status-error/20 text-status-error hover:bg-status-error/30"
						onClick={stopTurn}
						title="Stop"
					>
						<div className="h-2.5 w-2.5 rounded-[1px] bg-current" />
					</button>
				) : (
					<button
						type="button"
						className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-text-main hover:bg-white/20 disabled:opacity-30 transition-colors"
						onClick={() => void sendMessage()}
						disabled={
							sending ||
							(input.trim().length === 0 &&
								!selectedSkill &&
								!selectedPrompt &&
								!fileAttachments.some((att) => att.kind === 'image' || att.kind === 'localImage'))
						}
						title="Send (Ctrl/Cmd+Enter)"
					>
						<ArrowUp className="h-4 w-4" />
					</button>
				)}
			</div>
		</div>
	);
}
