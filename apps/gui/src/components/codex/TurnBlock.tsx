import { BookOpen, Brain, ChevronRight, Copy, File, FileText, Search, Terminal, Wrench, Zap } from 'lucide-react';
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
import type { SegmentedWorkingItem, WorkingItem } from './types';

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

function formatExplorationHeader(status: 'exploring' | 'explored', uniqueFileCount: number): { prefix: string; content: string } {
	const prefix = status === 'exploring' ? 'Exploring' : 'Explored';
	if (!uniqueFileCount || uniqueFileCount <= 0) return { prefix, content: '' };
	const unit = uniqueFileCount === 1 ? 'file' : 'files';
	return { prefix, content: `${uniqueFileCount} ${unit}` };
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
}: TurnBlockProps) {
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
					icon={<BookOpen className="h-3.5 w-3.5" />}
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

		const e = item as ChatEntry;
		if (e.kind === 'assistant' && e.role === 'message') {
			const showPlaceholder = !!e.renderPlaceholderWhileStreaming && !e.completed;
			const structured = e.structuredOutput && e.structuredOutput.type === 'code-review' ? e.structuredOutput : null;
			return (
				<div key={e.id} className="px-2 py-1">
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
					icon={<Terminal className="h-3.5 w-3.5" />}
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
						{e.prompt ? (
							<div className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-text-muted whitespace-pre-wrap break-words">{e.prompt}</div>
						) : null}
						<pre className="whitespace-pre-wrap break-words rounded-md bg-white/5 px-2 py-1 text-[10px] text-text-muted">
							{stringifyJsonSafe(agentsStates)}
						</pre>
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
					copyContent={e.text}
					icon={<Brain className="h-3.5 w-3.5" />}
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
		<div className="space-y-2">
			<div className="space-y-2">
				{turn.userEntries.map((e) => (
					<div key={e.id} className="flex justify-end">
						<div className="max-w-[77%] rounded-2xl bg-white/5 px-2.5 py-1.5 text-[11px] leading-[1.25] text-text-dim">
							{/* Attachments in message bubble */}
							{e.attachments && e.attachments.length > 0 ? (
								<div className="mb-2 flex flex-wrap gap-1">
									{e.attachments.map((att, idx) => (
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
							<ChatMarkdown text={e.text} className="text-[11px] !leading-[1.25] text-text-dim" textClassName="text-text-dim" dense />
						</div>
					</div>
				))}
			</div>

			{hasWorking ? (
				<button
					type="button"
					className="inline-flex items-center gap-2 rounded-full border border-border-menuDivider bg-bg-panel/20 px-3 py-1 text-left text-[12px] text-text-muted transition-colors hover:bg-bg-panelHover/30 hover:text-text-main"
					onClick={() => toggleTurnWorking(turn.id)}
				>
					<div className="flex items-center gap-2 text-[11px] text-text-muted">
						<span className="truncate font-medium">
							{turnStatusLabel(turn.status)}
							{turn.id === pendingTurnId ? ' (pending)' : ''}
						</span>
						<span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-text-menuDesc">{turn.workingItemCount}</span>
					</div>
					<ChevronRight className={['h-3.5 w-3.5 text-text-menuDesc transition-transform duration-200', workingOpen ? 'rotate-90' : ''].join(' ')} />
				</button>
			) : null}

			{hasWorking ? (
				<Collapse open={workingOpen} innerClassName="pt-0.5">
					<div className="space-y-1">
						{turn.workingItems.map((item) => {
							if (item.kind === 'exploration') {
								const { prefix, content } = formatExplorationHeader(item.status, item.uniqueFileCount);
								const collapsed = item.status === 'exploring' ? false : (collapsedByEntryId[item.id] ?? settings.defaultCollapseDetails);
								const hasItems = item.items.length > 0;
								const copyContent = content ? `${prefix} ${content}` : prefix;
								return (
									<ActivityBlock
										key={item.id}
										titlePrefix={prefix}
										titleContent={content}
										copyContent={copyContent}
										icon={<BookOpen className="h-3.5 w-3.5" />}
										contentClassName="space-y-1"
										collapsible={hasItems}
										collapsed={hasItems ? collapsed : true}
										onToggleCollapse={hasItems ? () => toggleEntryCollapse(item.id) : undefined}
									>
										{item.items.map((child) => renderWorkingItem(child))}
									</ActivityBlock>
								);
							}
							return renderWorkingItem(item.item);
						})}
					</div>
				</Collapse>
			) : null}

			<div className="space-y-2">
				{turn.assistantMessageEntries.map((e) => (
					<div key={e.id} className="px-1 py-1 text-[11px] leading-[1.25] text-text-dim">
						{e.renderPlaceholderWhileStreaming && !e.completed ? (
							<div className="text-[12px] text-text-menuDesc">Generating…</div>
						) : e.structuredOutput && e.structuredOutput.type === 'code-review' ? (
							<CodeReviewAssistantMessage output={e.structuredOutput} completed={!!e.completed} />
						) : (
							<ChatMarkdown text={e.text} className="text-[11px] !leading-[1.25] text-text-dim" textClassName="text-text-dim" dense />
						)}
					</div>
				))}
			</div>
		</div>
	);
}
