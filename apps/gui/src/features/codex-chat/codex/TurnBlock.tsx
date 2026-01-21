import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { Check, ChevronRight, Copy, Eye, File, FileText, GitBranch, Pencil, Zap } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Collapse } from '@/components/ui/Collapse';
import { ChatMarkdown } from './ChatMarkdown';
import { CodeReviewAssistantMessage } from './CodeReviewAssistantMessage';
import { TypewriterMarkdown } from './TypewriterMarkdown';
import { isReadingGroup, isReasoningGroup } from '../lib/turn/exploration';
import { ExplorationAccordion } from '../ui/turn/ExplorationAccordion';
import { TurnWorkingItem } from '../ui/turn/TurnWorkingItem';
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
	typewriterCharsPerSecond?: number;
	shouldTypewriterEntry?: (entryId: string) => boolean;
	consumeTypewriterEntry?: (entryId: string) => void;
	pendingTurnId: string;
	toggleTurnWorking: (turnId: string) => void;
	toggleEntryCollapse: (entryId: string) => void;
	approve: (requestId: number, decision: 'accept' | 'decline') => void;
	onForkFromTurn?: (turnId: string) => void;
	onEditUserEntry?: (entry: Extract<ChatEntry, { kind: 'user' }>) => void;
	animateIn?: boolean;
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

function TurnBlockImpl({
	turn,
	collapsedWorkingByTurnId,
	collapsedByEntryId,
	settings,
	typewriterCharsPerSecond,
	shouldTypewriterEntry,
	consumeTypewriterEntry,
	pendingTurnId,
	toggleTurnWorking,
	toggleEntryCollapse,
	approve,
	onForkFromTurn,
	onEditUserEntry,
	animateIn,
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

	const renderWorkingItem = useCallback(
		(item: WorkingItem): JSX.Element | null => {
			const key = isReadingGroup(item) || isReasoningGroup(item) ? item.id : (item as ChatEntry).id;
			return (
				<TurnWorkingItem
					key={key}
					item={item}
					turnId={turn.id}
					collapsedByEntryId={collapsedByEntryId}
					settings={settings}
					toggleEntryCollapse={toggleEntryCollapse}
					approve={approve}
					onForkFromTurn={onForkFromTurn}
					typewriterCharsPerSecond={typewriterCharsPerSecond}
					shouldTypewriterEntry={shouldTypewriterEntry}
					consumeTypewriterEntry={consumeTypewriterEntry}
				/>
			);
		},
		[
			approve,
			collapsedByEntryId,
			consumeTypewriterEntry,
			onForkFromTurn,
			settings,
			shouldTypewriterEntry,
			toggleEntryCollapse,
			turn.id,
			typewriterCharsPerSecond,
		]
	);

	const collapsedExplicit = collapsedWorkingByTurnId[turn.id];
	const workingOpen = collapsedExplicit === undefined ? turn.status === 'inProgress' : !collapsedExplicit;
	const hasWorking = turn.workingItemCount > 0;

	return (
		<div
			className={[
				'group/turn space-y-2 min-w-0 max-w-full',
				animateIn ? 'am-turn-animate-in' : '',
			].join(' ')}
		>
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
					<div key={e.id} className="flex min-w-0 max-w-full justify-end pl-12 pr-4">
						<div className="group/user min-w-0 max-w-[77%] break-words rounded-2xl bg-token-foreground/5 px-3 py-2 text-[12px] text-text-main">
							{/* Attachments in message bubble */}
							{e.attachments && e.attachments.length > 0
								? (() => {
										const imageAtts = e.attachments.filter((att) => att.type === 'image' || att.type === 'localImage');
										const labelAtts = e.attachments.filter((att) => att.type !== 'image' && att.type !== 'localImage');

										return (
											<div className="mb-2 space-y-2">
												{imageAtts.length > 0 ? (
													<div className="flex flex-wrap gap-2">
														{imageAtts.map((att, idx) => {
															const src = att.type === 'image' ? att.url : isTauri() ? convertFileSrc(att.path) : null;
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
								: null}
							{showRawUser ? (
								<pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-black/20 px-2 py-1 font-mono text-[12px] text-text-main">
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
				<div className="px-4">
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
				<Collapse open={workingOpen} innerClassName="pt-1 px-4">
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
					<div key={e.id} className="min-w-0 max-w-full pl-4 pr-8">
						<div className="min-w-0 max-w-full text-[12px] text-text-main">
							{e.renderPlaceholderWhileStreaming && !e.completed ? (
								<div className="text-[12px] text-text-muted italic">Generating…</div>
							) : rawAssistantById[e.id] ? (
								<pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-black/20 px-2 py-1 font-mono text-[12px] text-text-main">
									{e.text}
								</pre>
								) : e.structuredOutput && e.structuredOutput.type === 'code-review' ? (
									<CodeReviewAssistantMessage output={e.structuredOutput} completed={!!e.completed} />
								) : (
									<TypewriterMarkdown
										entryId={e.id}
										text={e.text}
										enabled={Boolean(shouldTypewriterEntry?.(e.id)) && Boolean(consumeTypewriterEntry)}
										completed={!!e.completed}
										charsPerSecond={typewriterCharsPerSecond}
										onConsume={consumeTypewriterEntry}
										className="text-[12px] text-text-main"
										textClassName="text-text-main"
										dense
									/>
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

// Prevent keystrokes in the composer (which update parent state) from re-rendering the entire thread view.
export const TurnBlock = memo(TurnBlockImpl);
