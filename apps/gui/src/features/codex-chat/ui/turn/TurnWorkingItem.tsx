import { ChevronRight, Copy, GitBranch, Search, Wrench, Zap } from 'lucide-react';
import { ActivityBlock } from '../../codex/ActivityBlock';
import { ChatMarkdown } from '../../codex/ChatMarkdown';
import { CodeReviewAssistantMessage } from '../../codex/CodeReviewAssistantMessage';
import { DiffCountBadge } from '../../codex/DiffCountBadge';
import { FileChangeEntryCard } from '../../codex/FileChangeEntryCard';
import { TypewriterMarkdown } from '../../codex/TypewriterMarkdown';
import type { ChatEntry, CodexChatSettings, WorkingItem } from '../../codex/types';
import { isReadingGroup, isReasoningGroup } from '../../lib/turn/exploration';
import { extractHeadingFromMarkdown } from '../../lib/turn/heading';
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
} from '../../codex/utils';

type Props = {
	item: WorkingItem;
	turnId: string;
	collapsedByEntryId: Record<string, boolean>;
	settings: CodexChatSettings;
	toggleEntryCollapse: (entryId: string) => void;
	approve: (requestId: number, decision: 'accept' | 'decline') => void;
	onForkFromTurn?: (turnId: string) => void;
	typewriterCharsPerSecond?: number;
	shouldTypewriterEntry?: (entryId: string) => boolean;
	consumeTypewriterEntry?: (entryId: string) => void;
};

export function TurnWorkingItem({
	item,
	turnId,
	collapsedByEntryId,
	settings,
	toggleEntryCollapse,
	approve,
	onForkFromTurn,
	typewriterCharsPerSecond,
	shouldTypewriterEntry,
	consumeTypewriterEntry,
}: Props): JSX.Element | null {
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
										{heading && item.entries.length > 1 ? <div className="text-[10px] font-medium text-text-muted mb-1">{heading}</div> : null}
										<TypewriterMarkdown
											entryId={entry.id}
											text={displayBody}
											enabled={Boolean(shouldTypewriterEntry?.(entry.id)) && Boolean(consumeTypewriterEntry)}
											completed={!isStreaming}
											charsPerSecond={typewriterCharsPerSecond}
											onConsume={consumeTypewriterEntry}
											className="text-[11px] text-text-muted"
											dense
										/>
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
			<div key={e.id} className="am-row min-w-0 max-w-full text-left">
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
		const collapsed = collapsedByEntryId[e.id] ?? settings.defaultCollapseDetails;
		const summary = buildFileChangeSummary(e);
		const isPending = e.status !== 'completed';
		const copyContent = summary.changes.map((change) => (change.diff ? `${change.path}\n${change.diff}`.trim() : change.path)).join('\n\n');
		return (
			<ActivityBlock
				key={e.id}
				titlePrefix={summary.titlePrefix}
				titleContent={summary.titleContent}
				status={e.status !== 'completed' ? e.status : undefined}
				copyContent={copyContent || summary.titleContent}
				summaryActions={<DiffCountBadge added={summary.totalAdded} removed={summary.totalRemoved} />}
				contentClassName="font-sans"
				scrollable={false}
				collapsible
				collapsed={collapsed}
				onToggleCollapse={() => toggleEntryCollapse(e.id)}
				approval={e.approval}
				onApprove={approve}
			>
				{summary.changes.length > 0 ? (
					<div className="space-y-2">
						{summary.changes.map((change) => (
							<FileChangeEntryCard
								key={`${change.path}-${change.kind.type}`}
								change={change}
								isPending={isPending}
								// Outer `Edited` block controls the accordion; inside diffs should be visible by default.
								defaultCollapsed={false}
							/>
						))}
					</div>
				) : (
					<div className="text-[10px] italic text-text-muted">No diff content</div>
				)}
			</ActivityBlock>
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
								onForkFromTurn(turnId);
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
				{hasBody ? (
					<TypewriterMarkdown
						entryId={e.id}
						text={displayBody}
						enabled={Boolean(shouldTypewriterEntry?.(e.id)) && Boolean(consumeTypewriterEntry)}
						completed={!e.streaming}
						charsPerSecond={typewriterCharsPerSecond}
						onConsume={consumeTypewriterEntry}
						className="text-[11px] text-text-muted"
						dense
					/>
				) : null}
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
}
