import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { Check, ChevronDown, ChevronRight, Copy, Eye, File, FileText, GitBranch, Pencil, Search, Wrench, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Collapse } from '../ui/Collapse';
import { ActivityBlock } from './ActivityBlock';
import { ChatMarkdown } from './ChatMarkdown';
import { CodeReviewAssistantMessage } from './CodeReviewAssistantMessage';
import { FileChangeEntryCard } from './FileChangeEntryCard';
import {
	buildFileChangeSummary,
	formatMcpArgsPreview,
	getCmdSummary,
	mcpContentToText,
	normalizeCommandOutput,
	prefixCommandLine,
	renderAnsiText,
	renderMcpContentBlocks,
	resolveParsedCmd,
	stringifyJsonSafe,
} from './utils';
import type { AssistantMessageEntry, ChatEntry, CodexChatSettings, TurnBlockStatus } from './types';
import type { ReasoningGroup, SegmentedWorkingItem, WorkingItem } from './types';

export type TurnBlockView = {
	id: string;
	status: TurnBlockStatus;
	userEntries: Array<Extract<ChatEntry, { kind: 'user' }>>;
	assistantMessageEntries: AssistantMessageEntry[];
	workingItems: SegmentedWorkingItem[];
	workingItemCount: number;
	workingRenderCount: number;
};

interface TurnBlockProps {
	turn: TurnBlockView;
	collapsedWorkingByTurnId: Record<string, boolean>;
	collapsedByEntryId: Record<string, boolean>;
	settings: CodexChatSettings;
	pendingTurnId: string;
	toggleTurnWorking: (turnId: string) => void;
	toggleEntryCollapse: (entryId: string) => void;
	approve: (requestId: number, decision: 'accept' | 'decline') => void;
	onForkFromTurn?: (turnId: string) => void;
	onEditUserEntry?: (entry: Extract<ChatEntry, { kind: 'user' }>) => void;
}

// ============================================================================
// VS Code Codex Plugin Parity: Heading Extraction
// ============================================================================
function extractHeadingFromMarkdown(text: string): { heading: string | null; body: string } {
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

function isReadingGroup(item: WorkingItem | undefined): item is Extract<WorkingItem, { kind: 'readingGroup' }> {
	return !!item && 'kind' in item && item.kind === 'readingGroup';
}

function isReasoningGroup(item: WorkingItem | undefined): item is ReasoningGroup {
	return !!item && 'kind' in item && item.kind === 'reasoningGroup';
}

type ExplorationCounts = { uniqueReadFileCount: number; searchCount: number; listCount: number };

function countExplorationCounts(items: WorkingItem[]): ExplorationCounts {
	const files = new Set<string>();
	let searchCount = 0;
	let listCount = 0;

	const visitCommand = (entry: Extract<ChatEntry, { kind: 'command' }>) => {
		const parsed = resolveParsedCmd(entry.command, entry.commandActions);
		if (parsed.type === 'read' && parsed.name) files.add(parsed.name);
		if (parsed.type === 'search') searchCount += 1;
		if (parsed.type === 'list_files') listCount += 1;
	};

	for (const item of items) {
		if (isReadingGroup(item)) {
			for (const entry of item.entries) visitCommand(entry);
			continue;
		}
		if (item.kind === 'command') {
			visitCommand(item);
		}
	}

	return { uniqueReadFileCount: files.size, searchCount, listCount };
}

function formatExplorationCounts(counts: ExplorationCounts): string {
	const parts: string[] = [];
	if (counts.uniqueReadFileCount > 0) parts.push(`${counts.uniqueReadFileCount} ${counts.uniqueReadFileCount === 1 ? 'file' : 'files'}`);
	if (counts.searchCount > 0) parts.push(`${counts.searchCount} ${counts.searchCount === 1 ? 'search' : 'searches'}`);
	// Match VSCode Codex plugin: "N list" (no plural).
	if (counts.listCount > 0) parts.push(`${counts.listCount} list`);
	return parts.join(', ');
}

function ExplorationAccordion({
	status,
	items,
	renderItem,
}: {
	status: 'exploring' | 'explored';
	items: WorkingItem[];
	renderItem: (item: WorkingItem) => JSX.Element | null;
}) {
	const exploring = status === 'exploring';
	const [expanded, setExpanded] = useState(false);
	const open = expanded || exploring;

	const itemCount = useMemo(() => {
		// `mergeReadingEntries` can turn multiple reads into a single `readingGroup`,
		// but the VSCode plugin's accordion logic treats each underlying action as a row.
		// We use this for parity in "hide counts when only one item" + auto-scroll triggers.
		let count = 0;
		for (const item of items) {
			if (isReadingGroup(item)) {
				count += item.entries.length;
				continue;
			}
			if (isReasoningGroup(item)) {
				count += item.entries.length;
				continue;
			}
			count += 1;
		}
		return count;
	}, [items]);

	const countsText = useMemo(() => {
		// Plugin parity: hide counts when there's only one item and still exploring.
		if (exploring && itemCount === 1) return '';
		return formatExplorationCounts(countExplorationCounts(items));
	}, [exploring, itemCount, items]);

	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [itemCount, open]);

	const requestExpand = useCallback(() => {
		if (!expanded) setExpanded(true);
	}, [expanded]);

	// Plugin parity: if there's only one exploration item and we're not exploring, show it directly (no accordion header).
	if (itemCount === 1 && items.length === 1 && !exploring) {
		return renderItem(items[0]);
	}

	const prefix = exploring ? 'Exploring' : 'Explored';

	return (
		<div className={['am-block', open ? 'am-block-open' : ''].join(' ')}>
			<div
				className="am-row group flex items-center gap-1.5 cursor-pointer select-none text-left"
				onClick={() => setExpanded((v) => !v)}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key !== 'Enter' && e.key !== ' ') return;
					e.preventDefault();
					setExpanded((v) => !v);
				}}
			>
				<span className="min-w-0 flex-1 truncate text-[11px] text-text-main/80">
					<span className="font-medium">{prefix}</span>
					{countsText ? <span className="ml-1 text-text-muted">{countsText}</span> : null}
				</span>
				<ChevronDown
					className={[
						'h-3.5 w-3.5 shrink-0 transition-transform duration-200 text-text-muted',
						expanded ? 'rotate-180' : '',
						open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
					].join(' ')}
				/>
			</div>

			<Collapse open={open} innerClassName="pt-0">
				<div className="am-shell min-w-0">
					<div className="relative">
						<div
							ref={scrollRef}
							className={[
								'am-shell-scroll am-scroll-fade min-w-0',
								'flex flex-col overflow-y-auto overflow-x-hidden',
								// Limit to roughly "10 rows" worth of items
								'max-h-72',
							].join(' ')}
						>
							{items.map((item) => {
								const key = isReadingGroup(item) ? item.id : (item as ChatEntry).id;
								return (
									<div
										key={key}
										className="first:pt-0 last:mb-0 mb-0.5 [&>*]:py-0 min-w-0"
										onMouseDown={requestExpand}
										onFocusCapture={requestExpand}
									>
										{renderItem(item)}
									</div>
								);
							})}
						</div>
					</div>
				</div>
			</Collapse>
		</div>
	);
}

function turnStatusLabel(status: TurnBlockStatus): string {
	switch (status) {
		case 'inProgress':
			return 'Working…';
		case 'completed':
			return 'Finished working';
		case 'failed':
			return 'Failed';
		case 'interrupted':
			return 'Interrupted';
		default:
			return 'Turn';
	}
}

export function TurnBlock({
	turn,
	collapsedWorkingByTurnId,
	collapsedByEntryId,
	settings,
	pendingTurnId,
	toggleTurnWorking,
	toggleEntryCollapse,
	approve,
	onForkFromTurn,
	onEditUserEntry,
}: TurnBlockProps) {
	const [didCopyUser, setDidCopyUser] = useState(false);
	const [didCopyAssistant, setDidCopyAssistant] = useState(false);
	const [showRawUser, setShowRawUser] = useState(false);
	const [rawAssistantById, setRawAssistantById] = useState<Record<string, boolean>>({});
	const lastUserEntry = turn.userEntries.length > 0 ? turn.userEntries[turn.userEntries.length - 1] : null;

	useEffect(() => {
		if (!didCopyUser) return;
		const timer = window.setTimeout(() => setDidCopyUser(false), 1200);
		return () => window.clearTimeout(timer);
	}, [didCopyUser]);

	useEffect(() => {
		if (!didCopyAssistant) return;
		const timer = window.setTimeout(() => setDidCopyAssistant(false), 1200);
		return () => window.clearTimeout(timer);
	}, [didCopyAssistant]);

	const userText = useMemo(() => {
		const parts = turn.userEntries.map((e) => e.text).filter(Boolean);
		return parts.join('\n\n');
	}, [turn.userEntries]);

	const finalAssistantText = useMemo(() => {
		const parts = turn.assistantMessageEntries.map((e) => e.text).filter(Boolean);
		return parts.join('\n\n');
	}, [turn.assistantMessageEntries]);

	const copyUserText = () => {
		if (!userText) return;
		void navigator.clipboard.writeText(userText);
		setDidCopyUser(true);
	};

	const copyFinalAssistantText = () => {
		if (!finalAssistantText) return;
		void navigator.clipboard.writeText(finalAssistantText);
		setDidCopyAssistant(true);
	};

	const toggleAssistantRaw = (entryId: string) => {
		setRawAssistantById((prev) => ({ ...prev, [entryId]: !prev[entryId] }));
	};

	const renderWorkingItem = (item: WorkingItem): JSX.Element | null => {
		if (isReadingGroup(item)) {
			const isFinished = item.entries.every((entry) => entry.status !== 'inProgress');
			const collapsed = collapsedByEntryId[item.id] ?? settings.defaultCollapseDetails;
			const parsedEntries = item.entries.map((entry) => ({
				entry,
				parsed: resolveParsedCmd(entry.command, entry.commandActions),
				output: normalizeCommandOutput(entry.output ?? null),
				displayOutput: prefixCommandLine(entry.command, entry.output ?? null),
			}));
			const uniqueByName: typeof parsedEntries = [];
			const seen = new Set<string>();
			for (let i = parsedEntries.length - 1; i >= 0; i -= 1) {
				const name = parsedEntries[i]?.parsed.name;
				if (!name) continue;
				if (seen.has(name)) continue;
				seen.add(name);
				uniqueByName.push(parsedEntries[i]);
			}
			uniqueByName.reverse();

			const lastUnique = uniqueByName[uniqueByName.length - 1];
			const lastName = lastUnique?.parsed.name || 'file';
			const count = Math.max(0, uniqueByName.length - 1);

			const prefix = isFinished ? 'Read' : 'Reading';
			const title = uniqueByName.length === 0 ? 'files' : uniqueByName.length === 1 ? lastName : `${lastName} +${count}`;

			const copyContent = parsedEntries
				.map(({ output, displayOutput }) => (output ? displayOutput : ''))
				.filter(Boolean)
				.join('\n\n');

			return (
				<ActivityBlock
					key={item.id}
					titlePrefix={prefix}
					titleContent={title}
					status={!isFinished ? 'in progress' : undefined}
					copyContent={copyContent.replace(/\x1b\[[0-9;]*m/g, '')}
					contentClassName="font-sans"
					collapsible
					collapsed={collapsed}
					onToggleCollapse={() => toggleEntryCollapse(item.id)}
				>
					{parsedEntries.some(({ output }) => output) ? (
						<div className="space-y-2">
							{parsedEntries
								.filter(({ output }) => output)
								.map(({ entry, parsed, displayOutput }) => (
									<div key={entry.id} className="space-y-1">
										<div className="text-[9px] font-medium text-text-muted">{parsed.name || 'file'}</div>
										<div className="whitespace-pre-wrap break-words font-mono text-[10px] text-text-muted">{renderAnsiText(displayOutput)}</div>
									</div>
								))}
						</div>
					) : null}
				</ActivityBlock>
			);
		}

		if (isReasoningGroup(item)) {
			const isStreaming = item.entries.some((entry) => entry.streaming);
			const collapsed = isStreaming ? false : (collapsedByEntryId[item.id] ?? settings.defaultCollapseDetails);

			// Extract headings from all entries
			const extractedEntries = item.entries.map((entry) => {
				const { heading, body } = extractHeadingFromMarkdown(entry.text);
				return { entry, heading, body };
			});

			// Build combined title from first entry with heading, or use default
			const firstWithHeading = extractedEntries.find((e) => e.heading);
			const prefix = isStreaming ? 'Thinking' : 'Thought';
			const titleContent = firstWithHeading?.heading || '';
			const count = item.entries.length;
			const displayTitle = count > 1 ? `${titleContent} +${count - 1}` : titleContent;

			// Combined copy content
			const copyContent = item.entries.map((e) => e.text).join('\n\n');

			// Combined body for display
			const bodyParts = extractedEntries
				.map(({ heading, body }) => (heading ? body : extractedEntries.find((e) => e.entry === extractedEntries[0]?.entry)?.entry.text || ''))
				.filter((b) => b.trim());
			const hasBody = bodyParts.length > 0;

			return (
				<ActivityBlock
					key={item.id}
					titlePrefix={prefix}
					titleContent={displayTitle}
					status={isStreaming ? 'Streaming…' : undefined}
					copyContent={copyContent}
					icon={null}
					contentVariant="markdown"
					collapsible={hasBody}
					collapsed={hasBody ? collapsed : true}
					onToggleCollapse={hasBody ? () => toggleEntryCollapse(item.id) : undefined}
				>
					{hasBody ? (
						<div className="space-y-2">
							{extractedEntries.map(({ entry, heading, body }) => {
								const displayBody = heading ? body : entry.text;
								const trimmedBody = displayBody.trim();
								if (!trimmedBody) return null;
								return (
									<div key={entry.id}>
										{heading && item.entries.length > 1 ? (
											<div className="text-[10px] font-medium text-text-muted mb-1">{heading}</div>
										) : null}
										<ChatMarkdown text={displayBody} className="text-[11px] text-text-muted" dense />
									</div>
								);
							})}
						</div>
					) : null}
				</ActivityBlock>
			);
		}

		const e = item as ChatEntry;
		if (e.kind === 'assistant' && e.role === 'message') {
			const showPlaceholder = !!e.renderPlaceholderWhileStreaming && !e.completed;
			const structured = e.structuredOutput && e.structuredOutput.type === 'code-review' ? e.structuredOutput : null;
			return (
				<div key={e.id} className="am-row text-left">
					{showPlaceholder ? (
						<div className="text-[11px] text-text-menuDesc">Generating…</div>
					) : structured ? (
						<CodeReviewAssistantMessage output={structured} completed={!!e.completed} />
					) : (
						<ChatMarkdown text={e.text} className="text-[11px] text-text-menuDesc" dense />
					)}
				</div>
			);
		}

		if (e.kind === 'command') {
			const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
			const displayContent = prefixCommandLine(e.command, e.output ?? null);
			const copyText = displayContent.replace(/\x1b\[[0-9;]*m/g, '');
			const parsed = resolveParsedCmd(e.command, e.commandActions);
			const isFinished = e.status !== 'inProgress';
			const summary = getCmdSummary(parsed, isFinished, e.command);
			const useMono = parsed.type === 'unknown' || parsed.type === 'format' || parsed.type === 'test' || parsed.type === 'lint';
			const open = !collapsed;
			const shellHeader = (
				<div className="group flex min-w-0 items-center justify-between gap-2">
					<div className="flex min-w-0 items-center gap-2">
						<span className="text-text-menuLabel">Shell</span>
						{e.cwd ? <span className="truncate font-mono text-[10px] text-text-menuDesc">{e.cwd}</span> : null}
					</div>
					<div className="flex items-center gap-1">
						{copyText ? (
							<button
								type="button"
								className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
								title="Copy shell"
								onClick={(ev) => {
									ev.stopPropagation();
									void navigator.clipboard.writeText(copyText);
								}}
							>
								<Copy className="h-3 w-3" />
							</button>
						) : null}
						<button
							type="button"
							className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
							title={open ? 'Collapse' : 'Expand'}
							onClick={(ev) => {
								ev.stopPropagation();
								toggleEntryCollapse(e.id);
							}}
						>
							<ChevronRight className={['h-3 w-3 transition-transform duration-200', open ? 'rotate-90' : ''].join(' ')} />
						</button>
					</div>
				</div>
			);
			return (
				<ActivityBlock
					key={e.id}
					titlePrefix={summary.prefix}
					titleContent={summary.content}
					titleMono={useMono}
					status={e.status !== 'completed' ? e.status : undefined}
					copyContent={copyText}
					containerClassName="am-block-command"
					contentVariant="ansi"
					collapsible
					collapsed={collapsed}
					onToggleCollapse={() => toggleEntryCollapse(e.id)}
					detailHeader={shellHeader}
					approval={e.approval}
					onApprove={approve}
				>
					{displayContent}
				</ActivityBlock>
			);
		}

		if (e.kind === 'fileChange') {
			const summary = buildFileChangeSummary(e);
			const isPending = e.status !== 'completed';
			const defaultCollapsed = settings.defaultCollapseDetails;
			const approval = e.approval;
			return (
				<div key={e.id} className="space-y-2">
					{summary.changes.length > 0 ? (
						summary.changes.map((change) => (
							<FileChangeEntryCard key={`${change.path}-${change.kind.type}`} change={change} isPending={isPending} defaultCollapsed={defaultCollapsed} />
						))
					) : (
						<div className="text-[10px] italic text-text-muted">No diff content</div>
					)}
					{approval ? (
						<div className="mt-1 flex flex-wrap items-center justify-between gap-2 pl-2 pr-1">
							<div className="min-w-0 text-xs text-text-muted">
								Approval required
								{approval.reason ? `: ${approval.reason}` : ''}.
							</div>
							<div className="flex shrink-0 gap-2">
								<button
									type="button"
									className="rounded-md bg-status-success/20 px-2.5 py-1 text-[11px] font-semibold text-status-success hover:bg-status-success/30 transition-colors"
									onClick={() => approve(approval.requestId, 'accept')}
								>
									Approve
								</button>
								<button
									type="button"
									className="rounded-md bg-status-error/15 px-2.5 py-1 text-[11px] font-semibold text-status-error hover:bg-status-error/25 transition-colors"
									onClick={() => approve(approval.requestId, 'decline')}
								>
									Decline
								</button>
							</div>
						</div>
					) : null}
				</div>
			);
		}

		if (e.kind === 'webSearch') {
			const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
			return (
				<ActivityBlock
					key={e.id}
					titlePrefix="Web search"
					titleContent={e.query}
					copyContent={e.query}
					icon={<Search className="h-3.5 w-3.5" />}
					contentVariant="plain"
					collapsible
					collapsed={collapsed}
					onToggleCollapse={() => toggleEntryCollapse(e.id)}
				>
					{e.query}
				</ActivityBlock>
			);
		}

		if (e.kind === 'collab') {
			const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
			const receivers = Array.isArray(e.receiverThreadIds) ? e.receiverThreadIds : [];
			const agentsStates = e.agentsStates ?? {};
			const copyContent = stringifyJsonSafe({
				tool: e.tool,
				status: e.status,
				senderThreadId: e.senderThreadId,
				receiverThreadIds: receivers,
				prompt: e.prompt ?? null,
				agentsStates,
			});
			return (
				<ActivityBlock
					key={e.id}
					titlePrefix="Collab:"
					titleContent={`${e.tool}${receivers.length > 0 ? ` → ${receivers.join(', ')}` : ''}`}
					titleMono
					status={e.status !== 'completed' ? e.status : undefined}
					copyContent={copyContent}
					icon={<Zap className="h-3.5 w-3.5" />}
					contentClassName="font-sans"
					collapsible
					collapsed={collapsed}
					onToggleCollapse={() => toggleEntryCollapse(e.id)}
				>
					<div className="space-y-2">
						<div className="text-[10px] text-text-muted">
							sender: <span className="font-mono">{e.senderThreadId}</span>
						</div>
						{receivers.length > 0 ? (
							<div className="text-[10px] text-text-muted">
								receivers:{' '}
								<span className="font-mono">
									{receivers.map((t, idx) => (
										<span key={`${t}-${idx}`}>{`${idx ? ', ' : ''}${t}`}</span>
									))}
								</span>
							</div>
						) : null}
						{e.prompt ? <div className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-text-muted whitespace-pre-wrap break-words">{e.prompt}</div> : null}
						<pre className="whitespace-pre-wrap break-words rounded-md bg-white/5 px-2 py-1 text-[10px] text-text-muted">{stringifyJsonSafe(agentsStates)}</pre>
					</div>
				</ActivityBlock>
			);
		}

		if (e.kind === 'mcp') {
			const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
			const contentBlocks = Array.isArray(e.result?.content) ? (e.result?.content ?? []) : [];
			const structuredContent = e.result?.structuredContent ?? null;
			const errorMessage = e.error?.message;
			const progressMessage = !e.result && !e.error ? e.message : undefined;
			const argsPreview = formatMcpArgsPreview(e.arguments);
			const toolLabel = `${e.server}.${e.tool}(${argsPreview})`;
			const hasContent = contentBlocks.length > 0;
			const hasStructured = structuredContent !== null && structuredContent !== undefined;
			const copyContent = [
				hasContent ? mcpContentToText(contentBlocks) : '',
				hasStructured ? stringifyJsonSafe(structuredContent) : '',
				errorMessage ?? '',
				progressMessage ?? '',
			]
				.filter(Boolean)
				.join('\n\n');
			return (
				<ActivityBlock
					key={e.id}
					titlePrefix="MCP:"
					titleContent={toolLabel}
					titleMono
					status={e.status !== 'completed' ? e.status : undefined}
					copyContent={copyContent || toolLabel}
					icon={<Wrench className="h-3.5 w-3.5" />}
					contentClassName="font-sans"
					collapsible
					collapsed={collapsed}
					onToggleCollapse={() => toggleEntryCollapse(e.id)}
				>
					<div className="space-y-2">
						{progressMessage ? <div className="text-[10px] text-text-muted">{progressMessage}</div> : null}
						{hasContent ? renderMcpContentBlocks(contentBlocks) : null}
						{errorMessage ? <div className="whitespace-pre-wrap text-[10px] text-status-error">{errorMessage}</div> : null}
						{hasStructured ? (
							<pre className="whitespace-pre-wrap break-words rounded-md bg-white/5 px-2 py-1 text-[10px] text-text-muted">
								{stringifyJsonSafe(structuredContent)}
							</pre>
						) : null}
						{!progressMessage && !hasContent && !errorMessage && !hasStructured ? (
							<div className="text-[10px] text-text-muted">Tool returned no content</div>
						) : null}
					</div>
				</ActivityBlock>
			);
		}

		if (e.kind === 'assistant' && e.role === 'reasoning') {
			const collapsed = e.streaming ? false : (collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails);

			const { heading, body } = extractHeadingFromMarkdown(e.text);
			const hasHeading = !!heading;
			const titlePrefix = hasHeading ? '' : e.streaming ? 'Thinking' : 'Thought';
			const titleContent = heading || '';
			const displayBody = hasHeading ? body : e.text;
			const trimmedBody = displayBody.trim();
			const hasBody = trimmedBody.length > 0;

			return (
				<ActivityBlock
					key={e.id}
					titlePrefix={titlePrefix}
					titleContent={titleContent}
					status={e.streaming ? 'Streaming…' : undefined}
					summaryActions={
						onForkFromTurn ? (
							<button
								type="button"
								className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
								title="Fork from this turn"
								onClick={(ev) => {
									ev.stopPropagation();
									onForkFromTurn(turn.id);
								}}
							>
								<GitBranch className="h-3 w-3" />
							</button>
						) : null
					}
					copyContent={e.text}
					icon={null}
					contentVariant="markdown"
					collapsible={hasBody}
					collapsed={hasBody ? collapsed : true}
					onToggleCollapse={hasBody ? () => toggleEntryCollapse(e.id) : undefined}
				>
					{hasBody ? <ChatMarkdown text={displayBody} className="text-[11px] text-text-muted" dense /> : null}
				</ActivityBlock>
			);
		}

		if (e.kind === 'system') {
			const tone = e.tone ?? 'info';
			const isError = tone === 'error';
			const hasDetails = !!e.additionalDetails;
			if (isError && hasDetails) {
				const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
				const summary = e.willRetry ? 'Error (retrying)' : 'Error';
				const content = `${e.text}\n\n${e.additionalDetails ?? ''}`.trim();
				return (
					<ActivityBlock
						key={e.id}
						titlePrefix={summary}
						titleContent={e.text}
						copyContent={content}
						collapsible
						collapsed={collapsed}
						onToggleCollapse={() => toggleEntryCollapse(e.id)}
					>
						{content}
					</ActivityBlock>
				);
			}
			const color =
				tone === 'error'
					? 'bg-status-error/10 text-status-error'
					: tone === 'warning'
						? 'bg-status-warning/10 text-status-warning'
						: 'bg-bg-panel/10 text-text-muted';

			return (
				<div key={e.id} className={`am-row am-row-hover text-xs ${color}`}>
					<div className="whitespace-pre-wrap break-words">{e.text}</div>
				</div>
			);
		}

		return null;
	};

	const collapsedExplicit = collapsedWorkingByTurnId[turn.id];
	const workingOpen = collapsedExplicit === undefined ? turn.status === 'inProgress' : !collapsedExplicit;
	const hasWorking = turn.workingItemCount > 0;

	return (
		<div className="group/turn space-y-2 min-w-0 max-w-full">
			{/* Turn title bar */}
			<div className="group flex items-center justify-end px-1">
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						className={[
							'rounded-md p-1 text-text-menuDesc transition-colors hover:bg-bg-menuItemHover hover:text-text-main',
							userText ? '' : 'pointer-events-none opacity-40',
						].join(' ')}
						title="Copy user message"
						onClick={(ev) => {
							ev.stopPropagation();
							copyUserText();
						}}
					>
						{didCopyUser ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
					</button>
					<button
						type="button"
						className={[
							'rounded-md p-1 text-text-menuDesc transition-colors hover:bg-bg-menuItemHover hover:text-text-main',
							userText ? '' : 'pointer-events-none opacity-40',
							showRawUser ? 'text-text-main' : '',
						].join(' ')}
						title={showRawUser ? '隐藏原始文本' : '显示原始文本'}
						onClick={(ev) => {
							ev.stopPropagation();
							setShowRawUser((prev) => !prev);
						}}
						>
							<Eye className="h-3 w-3" />
						</button>
						{onEditUserEntry && lastUserEntry ? (
							<button
								type="button"
								className="rounded-md p-1 text-text-menuDesc transition-colors hover:bg-bg-menuItemHover hover:text-text-main"
								title="编辑并重新运行"
								onClick={(ev) => {
									ev.stopPropagation();
									onEditUserEntry(lastUserEntry);
								}}
							>
								<Pencil className="h-3 w-3" />
							</button>
						) : null}
						{onForkFromTurn ? (
							<button
								type="button"
								className="rounded-md p-1 text-text-menuDesc transition-colors hover:bg-bg-menuItemHover hover:text-text-main"
								title="Fork from this turn"
							onClick={(ev) => {
								ev.stopPropagation();
								onForkFromTurn(turn.id);
							}}
						>
							<GitBranch className="h-3 w-3" />
						</button>
					) : null}
				</div>
			</div>

			<div className="space-y-2">
					{turn.userEntries.map((e) => (
						<div key={e.id} className="flex justify-end pl-12">
							<div className="group/user bg-token-foreground/5 max-w-[77%] break-words rounded-2xl px-3 py-2 text-[12px] text-text-main">
								{/* Attachments in message bubble */}
								{e.attachments && e.attachments.length > 0 ? (
									(() => {
										const imageAtts = e.attachments.filter((att) => att.type === 'image' || att.type === 'localImage');
										const labelAtts = e.attachments.filter((att) => att.type !== 'image' && att.type !== 'localImage');

										return (
											<div className="mb-2 space-y-2">
												{imageAtts.length > 0 ? (
													<div className="flex flex-wrap gap-2">
														{imageAtts.map((att, idx) => {
															const src =
																att.type === 'image'
																	? att.url
																	: isTauri()
																		? convertFileSrc(att.path)
																		: null;
															if (!src) return null;
															return (
																<img
																	key={`${e.id}-img-${idx}`}
																	src={src}
																	alt={att.name}
																	loading="lazy"
																	className="h-20 w-20 rounded-md bg-black/20 object-cover"
																/>
															);
														})}
													</div>
												) : null}

												{labelAtts.length > 0 ? (
													<div className="flex flex-wrap gap-1">
														{labelAtts.map((att, idx) => (
															<div
																key={`${e.id}-att-${idx}`}
																className={[
																	'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
																	att.type === 'file'
																		? 'bg-white/10 text-text-muted'
																		: att.type === 'skill'
																			? 'bg-primary/20 text-primary'
																			: 'bg-blue-500/20 text-blue-400',
																].join(' ')}
															>
																{att.type === 'file' ? (
																	<File className="h-3 w-3" />
																) : att.type === 'skill' ? (
																	<Zap className="h-3 w-3" />
																) : (
																	<FileText className="h-3 w-3" />
																)}
																<span className="max-w-[100px] truncate">{att.type === 'prompt' ? `prompts:${att.name}` : att.name}</span>
															</div>
														))}
													</div>
												) : null}
											</div>
										);
									})()
								) : null}
								{showRawUser ? (
									<pre className="whitespace-pre-wrap break-words rounded-md bg-black/20 px-2 py-1 font-mono text-[12px] text-text-main">
										{e.text}
									</pre>
								) : (
									<ChatMarkdown text={e.text} className="text-[12px] text-text-main" textClassName="text-text-main" dense />
								)}
							</div>
						</div>
					))}
				</div>

			{hasWorking ? (
				<div className="px-1">
					<button
						type="button"
						className="group flex w-full items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-1.5 text-left text-[11px] text-text-muted transition-colors hover:bg-white/10 hover:text-text-main"
						onClick={() => toggleTurnWorking(turn.id)}
					>
						<div className="flex flex-1 items-center gap-2">
							<ChevronRight className={['h-3.5 w-3.5 transition-transform duration-200', workingOpen ? 'rotate-90' : ''].join(' ')} />
							<span className="font-medium">
								{turnStatusLabel(turn.status)}
								{turn.id === pendingTurnId ? ' (pending)' : ''}
							</span>
							<span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] opacity-70 group-hover:opacity-100">{turn.workingItemCount} items</span>
						</div>
					</button>
				</div>
			) : null}

			{hasWorking ? (
				<Collapse open={workingOpen} innerClassName="pt-1 px-1">
					<div className="space-y-0 min-w-0">
						{turn.workingItems.map((item) => {
							if (item.kind === 'exploration') {
								return <ExplorationAccordion key={item.id} status={item.status} items={item.items} renderItem={renderWorkingItem} />;
							}
							return renderWorkingItem(item.item);
						})}
					</div>
				</Collapse>
			) : null}

			<div className="space-y-2">
				{turn.assistantMessageEntries.map((e) => (
					<div key={e.id} className="pr-8">
						<div className="text-[12px] text-text-main">
							{e.renderPlaceholderWhileStreaming && !e.completed ? (
								<div className="text-[12px] text-text-muted italic">Generating…</div>
							) : rawAssistantById[e.id] ? (
								<pre className="whitespace-pre-wrap break-words rounded-md bg-black/20 px-2 py-1 font-mono text-[12px] text-text-main">
									{e.text}
								</pre>
							) : e.structuredOutput && e.structuredOutput.type === 'code-review' ? (
								<CodeReviewAssistantMessage output={e.structuredOutput} completed={!!e.completed} />
							) : (
								<ChatMarkdown text={e.text} className="text-[12px] text-text-main" textClassName="text-text-main" dense />
							)}
						</div>
						<div className="mt-1 flex items-center justify-start gap-2 opacity-0 transition-opacity group-hover/turn:opacity-100">
							<button
								type="button"
								className={[
									'rounded p-1 text-text-muted hover:bg-white/10 hover:text-text-main transition-colors',
									e.text ? '' : 'pointer-events-none opacity-40',
								].join(' ')}
								title="Copy reply"
								onClick={(ev) => {
									ev.stopPropagation();
									copyFinalAssistantText();
								}}
							>
								{didCopyAssistant ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
							</button>
							<button
								type="button"
								className={[
									'rounded p-1 text-text-muted hover:bg-white/10 hover:text-text-main transition-colors',
									e.text ? '' : 'pointer-events-none opacity-40',
									rawAssistantById[e.id] ? 'text-text-main' : '',
								].join(' ')}
								title={rawAssistantById[e.id] ? '隐藏原始文本' : '显示原始文本'}
								onClick={(ev) => {
									ev.stopPropagation();
									toggleAssistantRaw(e.id);
								}}
							>
								<Eye className="h-3 w-3" />
							</button>
							{onForkFromTurn ? (
								<button
									type="button"
									className="rounded p-1 text-text-muted hover:bg-white/10 hover:text-text-main transition-colors"
									title="Fork from this turn"
									onClick={(ev) => {
										ev.stopPropagation();
										onForkFromTurn(turn.id);
									}}
								>
									<GitBranch className="h-3 w-3" />
								</button>
							) : null}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
