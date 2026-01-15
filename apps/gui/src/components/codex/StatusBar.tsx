import type React from 'react';
import { Brain, Box, Check, ChevronDown, FileText, Plus, SignalHigh, SignalLow, SignalMedium, SignalZero, Users, Zap } from 'lucide-react';
import type { CodexModelInfo, ReasoningEffort } from '../../types/codex';
import type { ApprovalPolicy } from './types/command';
import { MENU_STYLES } from './styles/menu-styles';

export type StatusPopover = 'profile' | 'approval_policy' | 'model' | 'model_reasoning_effort' | null;

interface StatusBarProps {
	openStatusPopover: StatusPopover;
	setOpenStatusPopover: React.Dispatch<React.SetStateAction<StatusPopover>>;
	clearStatusPopoverError: () => void;
	statusPopoverError: string | null;
	approvalPolicy: ApprovalPolicy;
	selectedModel: string | null;
	selectedModelInfo: CodexModelInfo | null;
	models: CodexModelInfo[];
	modelsError: string | null;
	selectedEffort: ReasoningEffort | null;
	effortOptions: Array<{ reasoningEffort: ReasoningEffort; description: string }>;
	contextUsageLabel: React.ReactNode;
	applyApprovalPolicy: (policy: ApprovalPolicy) => void | Promise<void>;
	applyModel: (model: string) => void | Promise<void>;
	applyReasoningEffort: (effort: ReasoningEffort) => void | Promise<void>;
}

function statusBarItemClass(active: boolean): string {
	return [
		'inline-flex h-6 min-w-0 items-center gap-1 rounded-md border border-border-menuDivider bg-bg-panel/30 px-2 text-[11px] transition-colors',
		active ? 'bg-bg-panelHover text-text-main' : 'text-text-muted hover:bg-bg-panelHover hover:text-text-main',
	].join(' ');
}

function reasoningEffortLabelEn(effort: ReasoningEffort): string {
	switch (effort) {
		case 'none':
			return 'None';
		case 'minimal':
			return 'Minimal';
		case 'low':
			return 'Low';
		case 'medium':
			return 'Medium';
		case 'high':
			return 'High';
		case 'xhigh':
			return 'Extra high';
		default:
			return effort;
	}
}

function translateReasoningDesc(desc: string): string {
	// 翻译 Codex API 返回的原始英文描述
	const translations: Record<string, string> = {
		// Low
		'Fast responses with lighter reasoning': '快速响应，轻量推理',
		'Fastest responses with limited reasoning': '最快响应，有限推理',
		'Balances speed with some reasoning; useful for straightforward queries and short explanations': '平衡速度与推理；适合简单查询和简短解释',
		// Medium
		'Balances speed and reasoning depth for everyday tasks': '平衡速度与推理深度，适合日常任务',
		'Dynamically adjusts reasoning based on the task': '根据任务动态调整推理深度',
		'Provides a solid balance of reasoning depth and latency for general-purpose tasks': '为通用任务提供推理深度与延迟的良好平衡',
		// High
		'Greater reasoning depth for complex problems': '更深的推理深度，适合复杂问题',
		'Maximizes reasoning depth for complex or ambiguous problems': '最大化推理深度，适合复杂或模糊问题',
		// XHigh
		'Extra high reasoning depth for complex problems': '超高推理深度，适合复杂问题',
		// Minimal
		'Fastest responses with little reasoning': '最快响应，几乎不进行推理',
	};
	return translations[desc] || desc;
}

function translateModelDesc(desc: string): string {
	// 翻译模型描述
	const translations: Record<string, string> = {
		// GPT models
		'Most capable GPT model for complex tasks': '最强大的 GPT 模型，适合复杂任务',
		'Fast and efficient for everyday tasks': '快速高效，适合日常任务',
		'Optimized for code generation and understanding': '针对代码生成和理解优化',
		'Compact model for quick responses': '紧凑模型，快速响应',
		'Mini model optimized for Codex tasks': '针对 Codex 任务优化的迷你模型',
		// Claude models
		'Most capable Claude model': '最强大的 Claude 模型',
		'Balanced performance and speed': '性能与速度平衡',
		'Fast and cost-effective': '快速且经济',
		// Generic descriptions
		'Default model': '默认模型',
		'Latest model version': '最新模型版本',
	};
	return translations[desc] || desc;
}

function reasoningEffortIcon(effort: ReasoningEffort, className = 'h-3 w-3'): JSX.Element {
	switch (effort) {
		case 'none':
		case 'minimal':
			return <SignalZero className={className} />;
		case 'low':
			return <SignalLow className={className} />;
		case 'medium':
			return <SignalMedium className={className} />;
		case 'high':
			return <SignalHigh className={className} />;
		case 'xhigh':
			return (
				<span className={`relative inline-flex ${className}`}>
					<SignalHigh className="h-full w-full" />
					<Plus className="absolute -right-1 -top-1 h-2 w-2" />
				</span>
			);
		default:
			return <Brain className={className} />;
	}
}

export function StatusBar({
	openStatusPopover,
	setOpenStatusPopover,
	clearStatusPopoverError,
	statusPopoverError,
	approvalPolicy,
	selectedModel,
	selectedModelInfo,
	models,
	modelsError,
	selectedEffort,
	effortOptions,
	contextUsageLabel,
	applyApprovalPolicy,
	applyModel,
	applyReasoningEffort,
}: StatusBarProps) {
	return (
		<>
			<div className="-mx-8 mt-2 flex h-8 items-center justify-between gap-2 bg-bg-panel/40 px-4 text-xs text-text-muted">
				<div className="flex min-w-0 flex-nowrap items-center gap-1">
					{/* Switch mode dropdown */}
					<div className="relative">
						<button
							type="button"
							className={statusBarItemClass(openStatusPopover === 'profile')}
							onClick={() => setOpenStatusPopover((prev) => (prev === 'profile' ? null : 'profile'))}
							title="Switch mode"
						>
							<span className="truncate">{approvalPolicy === 'never' ? 'Agent (full access)' : approvalPolicy === 'untrusted' ? 'Agent' : 'Custom'}</span>
							<ChevronDown className="h-3 w-3" />
						</button>

						{openStatusPopover === 'profile' ? (
							<div className={`absolute bottom-[28px] left-0 z-50 w-max py-1.5 ${MENU_STYLES.popover}`}>
								<div className={MENU_STYLES.popoverTitle}>Switch mode</div>
								<button
									type="button"
									className={MENU_STYLES.popoverItem}
									onClick={() => {
										void applyApprovalPolicy('untrusted');
										setOpenStatusPopover(null);
									}}
									title="需要用户批准所有操作"
								>
									<Users className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
									<span>Agent</span>
									<Check className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${approvalPolicy === 'untrusted' ? '' : 'invisible'}`} />
								</button>
								<button
									type="button"
									className={MENU_STYLES.popoverItem}
									onClick={() => {
										void applyApprovalPolicy('never');
										setOpenStatusPopover(null);
									}}
									title="自动执行所有操作，无需批准"
								>
									<Zap className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
									<span>Agent (full access)</span>
									<Check className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${approvalPolicy === 'never' ? '' : 'invisible'}`} />
								</button>
								<button
									type="button"
									className={MENU_STYLES.popoverItem}
									onClick={() => {
										void applyApprovalPolicy('on-request');
										setOpenStatusPopover(null);
									}}
									title="使用 config.toml 自定义批准策略"
								>
									<FileText className={`${MENU_STYLES.iconSm} text-text-menuLabel`} />
									<span>Custom (config.toml)</span>
									<Check
										className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${
											approvalPolicy === 'on-request' || approvalPolicy === 'on-failure' ? '' : 'invisible'
										}`}
									/>
								</button>
							</div>
						) : null}
					</div>

					<div className="relative">
						<button
							type="button"
							className={statusBarItemClass(openStatusPopover === 'model')}
							onClick={() => {
								clearStatusPopoverError();
								setOpenStatusPopover((prev) => (prev === 'model' ? null : 'model'));
							}}
							title="model"
						>
							<Box className="h-3.5 w-3.5 text-text-menuLabel" />
							<span className="truncate">{selectedModelInfo?.displayName ?? selectedModel ?? 'model'}</span>
							<ChevronDown className="h-3 w-3" />
						</button>

						{openStatusPopover === 'model' ? (
							<div className={`absolute bottom-[28px] left-0 z-50 w-max py-1.5 ${MENU_STYLES.popover}`}>
								<div className={MENU_STYLES.popoverTitle}>Select model</div>
								<div className="max-h-[40vh] overflow-auto">
									{models.length === 0 ? (
										<div className="px-3 py-1.5 text-[12px] text-text-muted">(unavailable)</div>
									) : (
										models.map((m) => {
											const selected = selectedModel === m.model;
											return (
												<button
													key={m.id}
													type="button"
													className={MENU_STYLES.popoverItem}
													onClick={() => void applyModel(m.model)}
													title={translateModelDesc(m.description)}
												>
													<span>{m.displayName}</span>
													<Check className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${selected ? '' : 'invisible'}`} />
												</button>
											);
										})
									)}
									{modelsError ? <div className="px-3 py-1 text-[11px] text-status-warning">{modelsError}</div> : null}
								</div>
							</div>
						) : null}
					</div>

					<div className="relative">
						<button
							type="button"
							className={statusBarItemClass(openStatusPopover === 'approval_policy')}
							onClick={() => {
								clearStatusPopoverError();
								setOpenStatusPopover((prev) => (prev === 'approval_policy' ? null : 'approval_policy'));
							}}
							title="approval_policy"
						>
							<span className="truncate">{approvalPolicy}</span>
							<ChevronDown className="h-3 w-3" />
						</button>

						{openStatusPopover === 'approval_policy' ? (
							<div className={`absolute bottom-[28px] left-0 z-50 w-max py-1.5 ${MENU_STYLES.popover}`}>
								<div className={MENU_STYLES.popoverTitle}>Approval policy</div>
								<div>
									{(['untrusted', 'on-request', 'on-failure', 'never'] as const).map((policy) => {
										const selected = approvalPolicy === policy;
										const policyTitles: Record<string, string> = {
											untrusted: '不信任模式，所有操作需要批准',
											'on-request': '按需批准，仅在请求时需要批准',
											'on-failure': '失败时批准，仅在操作失败时需要批准',
											never: '完全信任，自动执行所有操作',
										};
										return (
											<button
												key={policy}
												type="button"
												className={MENU_STYLES.popoverItem}
												onClick={() => void applyApprovalPolicy(policy)}
												title={policyTitles[policy]}
											>
												<span>{policy}</span>
												<Check className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${selected ? '' : 'invisible'}`} />
											</button>
										);
									})}
								</div>
							</div>
						) : null}
					</div>

					<div className="relative">
						<button
							type="button"
							className={statusBarItemClass(openStatusPopover === 'model_reasoning_effort')}
							onClick={() => {
								clearStatusPopoverError();
								setOpenStatusPopover((prev) => (prev === 'model_reasoning_effort' ? null : 'model_reasoning_effort'));
							}}
							title="model_reasoning_effort"
						>
							{selectedEffort ? reasoningEffortIcon(selectedEffort, 'h-3.5 w-3.5 text-text-menuLabel') : <Brain className="h-3.5 w-3.5 text-text-menuLabel" />}
							<span className="truncate">{selectedEffort ? reasoningEffortLabelEn(selectedEffort) : 'Default'}</span>
							<ChevronDown className="h-3 w-3" />
						</button>

						{openStatusPopover === 'model_reasoning_effort' ? (
							<div className={`absolute bottom-[28px] left-0 z-50 w-max py-1.5 ${MENU_STYLES.popover}`}>
								<div className={MENU_STYLES.popoverTitle}>Select reasoning</div>
								<div>
									{effortOptions.length === 0 ? (
										<div className="px-3 py-1.5 text-[12px] text-text-muted">Default</div>
									) : (
										effortOptions.map((opt) => {
											const selected = selectedEffort === opt.reasoningEffort;
											return (
												<button
													key={opt.reasoningEffort}
													type="button"
													className={MENU_STYLES.popoverItem}
													onClick={() => void applyReasoningEffort(opt.reasoningEffort)}
													title={translateReasoningDesc(opt.description)}
												>
													{reasoningEffortIcon(opt.reasoningEffort, `${MENU_STYLES.iconSm} text-text-menuLabel`)}
													<span>{reasoningEffortLabelEn(opt.reasoningEffort)}</span>
													<Check className={`ml-auto ${MENU_STYLES.iconSm} shrink-0 ${selected ? '' : 'invisible'}`} />
												</button>
											);
										})
									)}
								</div>
							</div>
						) : null}
					</div>
				</div>

				<div className="flex items-center gap-3">
					<div className="shrink-0">{contextUsageLabel}</div>
				</div>
			</div>

			{openStatusPopover ? <div className="fixed inset-0 z-40" onClick={() => setOpenStatusPopover(null)} role="button" tabIndex={0} /> : null}

			{statusPopoverError ? <div className="mt-2 text-xs text-status-warning">{statusPopoverError}</div> : null}
		</>
	);
}
