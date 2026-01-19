import ReactMarkdown from 'react-markdown';
import { useMemo, useState } from 'react';
import type { CodeReviewFinding, CodeReviewStructuredOutput } from './assistantMessage';
import { isHighPriorityFinding, parsePriorityTagFromTitle } from './assistantMessage';

function MarkdownBody({ text }: { text: string }) {
	const normalized = useMemo(() => {
		const lines = (text ?? '').split('\n');
		let inFence = false;
		const out: string[] = [];
		for (const line of lines) {
			const trimmed = line.trimStart();
			if (trimmed.startsWith('```')) {
				inFence = !inFence;
				out.push(line);
				continue;
			}
			out.push(inFence ? line : `${line}  `);
		}
		return out.join('\n');
	}, [text]);

	return (
		<div className="min-w-0 max-w-full break-words text-[11px] leading-[1.35] text-text-menuDesc">
			<ReactMarkdown
				components={{
					p: ({ children }) => <p className="my-0.5 whitespace-pre-wrap break-words">{children}</p>,
					ul: ({ children }) => <ul className="my-0.5 list-disc pl-5">{children}</ul>,
					ol: ({ children }) => <ol className="my-0.5 list-decimal pl-5">{children}</ol>,
					li: ({ children }) => <li className="my-0.5">{children}</li>,
					pre: ({ children }) => (
						<pre className="my-1.5 max-w-full overflow-x-auto rounded-md bg-black/25 px-2 py-1.5 font-mono text-[10px] leading-snug text-text-menuDesc">{children}</pre>
					),
					code: ({ className, children }) => {
						const isBlock = typeof className === 'string' && className.includes('language-');
						return !isBlock ? (
							<code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] text-text-menuDesc">{children}</code>
						) : (
							<code className="font-mono text-[10px] text-text-menuDesc">{children}</code>
						);
					},
				}}
			>
				{normalized}
			</ReactMarkdown>
		</div>
	);
}

function PriorityTitle({ title }: { title: string }) {
	const parsed = parsePriorityTagFromTitle(title);
	if (!parsed) {
		return <div className="max-w-full break-words text-[12px] font-semibold text-text-muted">{title}</div>;
	}
	return (
		<div className="flex min-w-0 items-center gap-2">
			<span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-text-muted">{parsed.tag}</span>
			<div className="min-w-0 break-words text-[12px] font-semibold text-text-muted">{parsed.rest}</div>
		</div>
	);
}

function FindingCard({ finding }: { finding: CodeReviewFinding }) {
	const location = `${finding.code_location.absolute_file_path}:${finding.code_location.line_range.start}-${finding.code_location.line_range.end}`;
	return (
		<div className="min-w-0 max-w-full rounded-xl border border-token-border/70 bg-token-inputBackground/45 px-3 py-2">
			<div className="flex flex-col gap-1">
				<PriorityTitle title={finding.title} />
				<div className="text-[10px] text-text-menuDesc">{location}</div>
			</div>
			<div className="mt-1">
				<MarkdownBody text={finding.body} />
			</div>
		</div>
	);
}

export function CodeReviewAssistantMessage(props: { output: CodeReviewStructuredOutput; completed: boolean }): JSX.Element {
	const findings = useMemo(() => props.output.findings ?? [], [props.output.findings]);
	const split = useMemo(() => {
		const primary: CodeReviewFinding[] = [];
		const secondary: CodeReviewFinding[] = [];
		for (const f of findings) {
			(isHighPriorityFinding(f) ? primary : secondary).push(f);
		}
		return { primary, secondary };
	}, [findings]);

	const [showLowPriority, setShowLowPriority] = useState(false);

	if (findings.length === 0) {
		return props.completed ? (
			<div className="rounded-xl border border-token-border/70 bg-token-inputBackground/45 px-3 py-2 text-[11px] text-text-menuDesc">
				No findings were reported.
			</div>
		) : (
			<div className="text-[11px] text-text-menuDesc">Generating…</div>
		);
	}

	return (
		<div className="flex min-w-0 max-w-full flex-col gap-2 py-1.5">
			{split.primary.length === 0 ? (
				<div className="rounded-xl border border-token-border/70 bg-token-inputBackground/45 px-3 py-2 text-[11px] text-text-menuDesc">
					Codex did not find any high priority issues.
				</div>
			) : null}
			{split.primary.map((f, idx) => (
				<FindingCard key={`${f.title}-${idx}`} finding={f} />
			))}

			{split.secondary.length > 0 ? (
				<div className="flex flex-col gap-2">
					<button
						type="button"
						className="mx-auto mt-1 w-max cursor-pointer text-[11px] text-text-menuDesc hover:text-text-muted"
						onClick={() => setShowLowPriority((v) => !v)}
					>
						{showLowPriority ? 'Hide low priority findings' : `${split.secondary.length} low priority findings`}
					</button>
					{showLowPriority ? (
						<div className="flex flex-col gap-2">
							{split.secondary.map((f, idx) => (
								<FindingCard key={`${f.title}-${idx}`} finding={f} />
							))}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
