import ReactMarkdown from 'react-markdown';
import { useMemo } from 'react';

function markdownWithHardBreaks(text: string): string {
	if (!text) return '';
	const lines = text.split('\n');
	let inFence = false;
	const out: string[] = [];
	for (const line of lines) {
		const trimmed = line.trimStart();
		if (trimmed.startsWith('```')) {
			inFence = !inFence;
			out.push(line);
			continue;
		}
		// Mimic remark-breaks (single newline -> <br>) without pulling extra deps:
		// add trailing "  " so markdown treats newline as a hard break.
		out.push(inFence ? line : `${line}  `);
	}
	return out.join('\n');
}

export interface ChatMarkdownProps {
	text: string;
	className?: string;
	textClassName?: string;
	dense?: boolean;
}

export function ChatMarkdown({ text, className, textClassName, dense = false }: ChatMarkdownProps) {
	const normalized = useMemo(() => markdownWithHardBreaks(text), [text]);
	const leadingClass = dense ? 'leading-[1.35]' : 'leading-relaxed';
	const paragraphClass = dense ? 'my-0.5 whitespace-pre-wrap break-words' : 'my-1 whitespace-pre-wrap break-words';
	const listClass = dense ? 'my-0.5' : 'my-1';
	const preClass = dense ? 'my-1.5' : 'my-2';
	const textClass = textClassName ?? 'text-text-muted';

	return (
		<div
			className={[
				'min-w-0 max-w-full',
				// Align with VSCode plugin: remove first list top margin.
				'[&>ol:first-child]:mt-0 [&>ul:first-child]:mt-0 [&>p:first-child]:mt-0',
				`break-words ${leadingClass}`,
				className ?? '',
			].join(' ')}
		>
			<ReactMarkdown
				components={{
					p: ({ children }) => <p className={`${paragraphClass} ${textClass}`}>{children}</p>,
					ul: ({ children }) => <ul className={`${listClass} list-disc pl-5 ${textClass}`}>{children}</ul>,
					ol: ({ children }) => <ol className={`${listClass} list-decimal pl-5 ${textClass}`}>{children}</ol>,
					li: ({ children }) => <li className={`my-0.5 ${textClass}`}>{children}</li>,
					pre: ({ children }) => (
						<pre
							className={`${preClass} max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 px-3 py-2 text-[11px] leading-snug ${textClass}`}
						>
							{children}
						</pre>
					),
					code: ({ className, children }) => {
						const isBlock = typeof className === 'string' && className.includes('language-');
						return !isBlock ? (
							<code className={`rounded bg-white/10 px-1 py-0 font-mono text-[11px] leading-[1.25] ${textClass}`}>{children}</code>
						) : (
							<code className={`font-mono text-[11px] ${textClass}`}>{children}</code>
						);
					},
					a: ({ href, children }) => (
						<a href={href} className="text-blue-400 underline underline-offset-2 hover:text-blue-300" target="_blank" rel="noreferrer">
							{children}
						</a>
					),
				}}
			>
				{normalized}
			</ReactMarkdown>
		</div>
	);
}
