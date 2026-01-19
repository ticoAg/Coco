import type { AgentInstance, Gate, Milestone, Task } from '@/types/task';
import { formatDate } from '../../lib/format';

function MilestoneItem({ milestone }: { milestone: Milestone }) {
	const icon = {
		pending: '○',
		working: '◐',
		done: '●',
		blocked: '⚠',
	}[milestone.state];

	const color = {
		pending: 'text-text-muted',
		working: 'text-status-info',
		done: 'text-status-success',
		blocked: 'text-status-warning',
	}[milestone.state];

	return (
		<div className="flex items-start gap-3 rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2">
			<div className={`mt-[2px] font-mono ${color}`}>{icon}</div>
			<div className="min-w-0">
				<div className="text-sm font-medium">{milestone.title}</div>
				<div className="mt-1 text-xs text-text-muted">
					{milestone.state}
					{milestone.dependsOn?.length ? ` • deps: ${milestone.dependsOn.join(', ')}` : ''}
				</div>
			</div>
		</div>
	);
}

function AgentCard({ agent }: { agent: AgentInstance }) {
	const color = {
		pending: 'text-text-muted',
		active: 'text-status-info',
		awaiting: 'text-text-muted',
		dormant: 'text-text-dim',
		completed: 'text-status-success',
		failed: 'text-status-error',
	}[agent.state];

	return (
		<div className="rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2">
			<div className="flex items-center justify-between gap-2">
				<div className="truncate text-sm font-semibold">{agent.instance}</div>
				<div className={`text-xs font-medium ${color}`}>{agent.state}</div>
			</div>
			<div className="mt-1 text-xs text-text-muted">{agent.agent}</div>
			{agent.skills?.length ? (
				<div className="mt-2 flex flex-wrap gap-1">
					{agent.skills.map((s) => (
						<span key={s} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-text-muted">
							{s}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}

function GateItem({ gate }: { gate: Gate }) {
	const badge = {
		open: 'bg-white/10 text-text-muted',
		blocked: 'bg-status-warning/15 text-status-warning',
		approved: 'bg-status-success/15 text-status-success',
		rejected: 'bg-status-error/15 text-status-error',
	}[gate.state];

	return (
		<div className="rounded-lg border border-white/10 bg-bg-panelHover px-3 py-2">
			<div className="flex items-center justify-between gap-2">
				<div className="text-xs uppercase tracking-wide text-text-muted">{gate.type}</div>
				<span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}>{gate.state}</span>
			</div>
			{gate.reason ? <div className="mt-2 text-sm">{gate.reason}</div> : null}
			<div className="mt-2 text-xs text-text-muted">{gate.instructionsRef ? `instructions: ${gate.instructionsRef}` : null}</div>
		</div>
	);
}

export function OverviewTab({ task }: { task: Task }) {
	return (
		<div className="space-y-6">
			<div>
				<h3 className="text-sm font-semibold">Info</h3>
				<div className="mt-3 grid grid-cols-2 gap-3 text-sm">
					<div className="rounded-lg border border-white/10 bg-bg-panelHover p-3">
						<div className="text-xs uppercase tracking-wide text-text-muted">Topology</div>
						<div className="mt-1 font-mono">{task.topology}</div>
					</div>
					<div className="rounded-lg border border-white/10 bg-bg-panelHover p-3">
						<div className="text-xs uppercase tracking-wide text-text-muted">State</div>
						<div className="mt-1 font-mono">{task.state}</div>
					</div>
					<div className="rounded-lg border border-white/10 bg-bg-panelHover p-3">
						<div className="text-xs uppercase tracking-wide text-text-muted">Created</div>
						<div className="mt-1 font-mono">{formatDate(task.createdAt)}</div>
					</div>
					<div className="rounded-lg border border-white/10 bg-bg-panelHover p-3">
						<div className="text-xs uppercase tracking-wide text-text-muted">Updated</div>
						<div className="mt-1 font-mono">{formatDate(task.updatedAt)}</div>
					</div>
				</div>
				{task.description ? (
					<div className="mt-4 rounded-lg border border-white/10 bg-bg-panelHover p-3 text-sm text-text-muted">{task.description}</div>
				) : null}
			</div>

			{task.gates?.length ? (
				<div>
					<h3 className="text-sm font-semibold">Gates</h3>
					<div className="mt-3 space-y-3">
						{task.gates.map((g) => (
							<GateItem key={g.id} gate={g} />
						))}
					</div>
				</div>
			) : null}

			{task.milestones?.length ? (
				<div>
					<h3 className="text-sm font-semibold">Milestones</h3>
					<div className="mt-3 space-y-3">
						{task.milestones.map((m) => (
							<MilestoneItem key={m.id} milestone={m} />
						))}
					</div>
				</div>
			) : null}

			{task.roster?.length ? (
				<div>
					<h3 className="text-sm font-semibold">Roster</h3>
					<div className="mt-3 grid grid-cols-2 gap-3">
						{task.roster.map((a) => (
							<AgentCard key={a.instance} agent={a} />
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

export default OverviewTab;
