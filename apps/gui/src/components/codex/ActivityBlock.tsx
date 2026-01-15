import { useState } from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { Collapse } from '../ui/Collapse';
import { ChatMarkdown } from './ChatMarkdown';
import { renderAnsiText } from './utils';

type ActivityContentVariant = 'plain' | 'markdown' | 'ansi';

export interface ActivityBlockProps {
	/** 标题前缀，如 "Ran", "Edited" */
	titlePrefix: string;
	/** 标题主要内容 */
	titleContent: string;
	/** 标题是否使用等宽字体 */
	titleMono?: boolean;
	/** 标题右侧额外操作 */
	summaryActions?: React.ReactNode;
	/** 状态文本 */
	status?: string;
	/** 复制内容 */
	copyContent: string;
	/** 内容渲染类型 */
	contentVariant?: ActivityContentVariant;
	/** 内容是否强制等宽字体 */
	contentMono?: boolean;
	/** 内容区域额外样式 */
	contentClassName?: string;
	/** 是否可折叠 */
	collapsible?: boolean;
	/** 是否已折叠 */
	collapsed?: boolean;
	/** 切换折叠状态 */
	onToggleCollapse?: () => void;
	/** 内容区域 */
	children?: React.ReactNode;
	/** 详情区头部（可选） */
	detailHeader?: React.ReactNode;
	/** 审批信息 */
	approval?: {
		requestId: number;
		reason?: string | null;
	};
	/** 审批回调 */
	onApprove?: (requestId: number, decision: 'accept' | 'decline') => void;
	/** 左侧图标（可选） */
	icon?: React.ReactNode;
}

export function ActivityBlock({
	titlePrefix,
	titleContent,
	titleMono = false,
	summaryActions,
	status,
	copyContent,
	contentVariant = 'plain',
	contentMono,
	contentClassName,
	collapsible = false,
	collapsed = true,
	onToggleCollapse,
	children,
	detailHeader,
	approval,
	onApprove,
	icon,
}: ActivityBlockProps) {
	const [summaryHover, setSummaryHover] = useState(false);
	const [didCopy, setDidCopy] = useState(false);
	const isStringChild = typeof children === 'string';
	const effectiveVariant: ActivityContentVariant = contentVariant;
	const useMono = contentMono ?? effectiveVariant === 'ansi';
	const contentNode = (() => {
		if (!isStringChild) return children;
		if (effectiveVariant === 'markdown') {
			return <ChatMarkdown text={children} className="text-[11px] text-text-muted" dense />;
		}
		if (effectiveVariant === 'ansi') {
			return renderAnsiText(children);
		}
		return children;
	})();
	const showStatus = status && status !== 'completed';
	const open = !collapsible || !collapsed;
	const showOpenBorder = collapsible && open;

	return (
		<div className={['min-w-0 am-block', showOpenBorder ? 'am-block-open' : '', summaryHover ? 'am-block-hover' : ''].join(' ')}>
			{/* Summary row (compact) */}
			<div
				className={['am-row group flex min-w-0 items-center justify-between gap-2', collapsible && onToggleCollapse ? 'cursor-pointer' : ''].join(' ')}
				role={collapsible && onToggleCollapse ? 'button' : undefined}
				tabIndex={collapsible && onToggleCollapse ? 0 : undefined}
				onMouseEnter={() => setSummaryHover(true)}
				onMouseLeave={() => {
					setSummaryHover(false);
					setDidCopy(false);
				}}
				onFocus={() => setSummaryHover(true)}
				onBlur={() => {
					setSummaryHover(false);
					setDidCopy(false);
				}}
				onClick={() => {
					if (collapsible && onToggleCollapse) onToggleCollapse();
				}}
				onKeyDown={(e) => {
					if (!collapsible || !onToggleCollapse) return;
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onToggleCollapse();
					}
				}}
			>
				<div className="min-w-0 flex-1 truncate text-[13px]">
					<span className="inline-flex min-w-0 items-center gap-2">
						{icon ? <span className="shrink-0 text-text-menuDesc">{icon}</span> : null}
						<span className="shrink-0 font-medium text-text-menuLabel">{titlePrefix}</span>
						<span className={['am-row-title truncate text-text-main/90', titleMono ? 'font-mono text-[12px]' : ''].join(' ')}>{titleContent}</span>
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{showStatus ? <span className="text-[10px] text-text-menuDesc opacity-80">{status}</span> : null}
					{summaryActions ? <div className="flex items-center gap-2">{summaryActions}</div> : null}
					<button
						type="button"
						className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
						title="Copy content"
						onClick={(ev) => {
							ev.stopPropagation();
							void navigator.clipboard.writeText(copyContent);
							setDidCopy(true);
						}}
					>
						{didCopy ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
					</button>
					{collapsible && onToggleCollapse ? (
						<button
							type="button"
							className="rounded-md p-1 text-text-menuDesc opacity-0 transition-opacity hover:bg-bg-menuItemHover hover:text-text-main group-hover:opacity-100"
							title={open ? 'Collapse' : 'Expand'}
							onClick={(ev) => {
								ev.stopPropagation();
								onToggleCollapse();
							}}
						>
							<ChevronRight className={['h-3 w-3 transition-transform duration-200', open ? 'rotate-90' : ''].join(' ')} />
						</button>
					) : null}
				</div>
			</div>

			{/* Details (only when expanded) */}
			{children ? (
				<Collapse open={open} innerClassName="pt-0">
					<div className="am-shell">
						{detailHeader ? <div className="am-shell-header">{detailHeader}</div> : null}
						<div className="am-shell-scroll am-scroll-fade">
							<div
								className={[
									'min-w-0 text-[12px] leading-[1.5] text-text-muted',
									useMono ? 'font-mono font-medium' : 'font-sans',
									effectiveVariant === 'markdown' ? 'whitespace-normal' : effectiveVariant === 'ansi' ? 'whitespace-pre' : 'whitespace-pre-wrap break-words',
									contentClassName ?? '',
								].join(' ')}
							>
								{contentNode}
							</div>
						</div>
					</div>
				</Collapse>
			) : null}

			{/* Approval (compact, inline) */}
			{approval && onApprove ? (
				<div className="mt-1 flex flex-wrap items-center justify-between gap-2 pl-3 pr-1">
					<div className="min-w-0 text-xs text-text-muted">
						Approval required
						{approval.reason ? `: ${approval.reason}` : ''}.
					</div>
					<div className="flex shrink-0 gap-2">
						<button
							type="button"
							className="rounded-md bg-status-success/20 px-2.5 py-1 text-[11px] font-semibold text-status-success hover:bg-status-success/30 transition-colors"
							onClick={() => onApprove(approval.requestId, 'accept')}
						>
							Approve
						</button>
						<button
							type="button"
							className="rounded-md bg-status-error/15 px-2.5 py-1 text-[11px] font-semibold text-status-error hover:bg-status-error/25 transition-colors"
							onClick={() => onApprove(approval.requestId, 'decline')}
						>
							Decline
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}
