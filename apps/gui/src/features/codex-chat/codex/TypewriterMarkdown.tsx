import { useEffect, useRef, useState } from 'react';
import { ChatMarkdown, type ChatMarkdownProps } from './ChatMarkdown';

const DEFAULT_CHARS_PER_SEC = 80;
const TICK_MS = 50;

export type TypewriterMarkdownProps = Omit<ChatMarkdownProps, 'text'> & {
	/** Stable id for the message block (used to consume one-shot animation eligibility). */
	entryId: string;
	text: string;
	enabled: boolean;
	/** Set true when the entry is finalized (no more deltas expected). */
	completed?: boolean;
	charsPerSecond?: number;
	onConsume?: (entryId: string) => void;
};

export function TypewriterMarkdown({
	entryId,
	text,
	enabled,
	completed = false,
	charsPerSecond,
	onConsume,
	className,
	textClassName,
	dense = false,
}: TypewriterMarkdownProps) {
	// Freeze eligibility at mount: once we decide to animate, we keep animating even if the parent
	// consumes the id and flips `enabled` on subsequent renders.
	const animateRef = useRef(enabled);
	const animate = animateRef.current;

	useEffect(() => {
		if (!animate) return;
		onConsume?.(entryId);
	}, [animate, entryId, onConsume]);

	const cps = charsPerSecond ?? DEFAULT_CHARS_PER_SEC;
	const textRef = useRef(text);
	const startMsRef = useRef<number | null>(null);
	const baseCountRef = useRef(0);
	const visibleCountRef = useRef(0);
	const [visibleCount, setVisibleCount] = useState(() => (animate ? 0 : text.length));
	const [renderMarkdown, setRenderMarkdown] = useState(() => !animate);

	useEffect(() => {
		textRef.current = text;
		// If we aren't animating, always show the full current text.
		if (!animate) setVisibleCount(text.length);
	}, [animate, text]);

	useEffect(() => {
		visibleCountRef.current = visibleCount;
	}, [visibleCount]);

	useEffect(() => {
		if (!animate || renderMarkdown) return;
		// Use a one-shot timeout loop so we don't leave hundreds of idle intervals running,
		// which can cause noticeable typing latency in the composer.
		let cancelled = false;
		let handle: number | null = null;

		const tick = () => {
			if (cancelled) return;
			const targetLen = textRef.current.length;
			if (visibleCountRef.current >= targetLen) {
				// Caught up; pause the clock so late-arriving deltas don't "skip ahead".
				startMsRef.current = null;
				baseCountRef.current = visibleCountRef.current;
				return;
			}

			if (startMsRef.current == null) {
				// Start/restart the clock from the current visible position.
				startMsRef.current = performance.now();
				baseCountRef.current = visibleCountRef.current;
			}

			const elapsedMs = performance.now() - (startMsRef.current ?? performance.now());
			const ideal = baseCountRef.current + Math.floor((elapsedMs * cps) / 1000);
			const nextLen = Math.min(targetLen, ideal);

			if (nextLen > visibleCountRef.current) {
				visibleCountRef.current = nextLen;
				setVisibleCount(nextLen);
			}

			handle = window.setTimeout(tick, TICK_MS);
		};

		// Only schedule work when there's something left to print.
		if (visibleCountRef.current < textRef.current.length) {
			handle = window.setTimeout(tick, TICK_MS);
		}

		return () => {
			cancelled = true;
			if (handle != null) window.clearTimeout(handle);
		};
	}, [animate, cps, renderMarkdown, text]);

	useEffect(() => {
		if (!animate) return;
		if (renderMarkdown) return;
		// Stream as plain text to avoid repeatedly parsing markdown while animating.
		// Once the entry is finalized and we've printed the whole thing, render markdown once.
		if (!completed) return;
		if (visibleCount < text.length) return;
		setRenderMarkdown(true);
	}, [animate, completed, renderMarkdown, text.length, visibleCount]);

	if (renderMarkdown) {
		return <ChatMarkdown text={text} className={className} textClassName={textClassName} dense={dense} />;
	}

	const leadingClass = dense ? 'leading-[1.35]' : 'leading-relaxed';
	const textClass = textClassName ?? 'text-text-muted';
	const displayText = animate ? text.slice(0, visibleCount) : text;
	return (
		<div className={['min-w-0 max-w-full whitespace-pre-wrap break-words', leadingClass, className ?? ''].join(' ')}>
			<span className={textClass}>{displayText}</span>
		</div>
	);
}
