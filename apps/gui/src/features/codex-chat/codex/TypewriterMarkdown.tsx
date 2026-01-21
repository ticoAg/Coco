import { useEffect, useRef, useState } from 'react';
import { ChatMarkdown, type ChatMarkdownProps } from './ChatMarkdown';

const DEFAULT_CHARS_PER_SEC = 80;
const TICK_MS = 50;

export type TypewriterMarkdownProps = Omit<ChatMarkdownProps, 'text'> & {
	/** Stable id for the message block (used to consume one-shot animation eligibility). */
	entryId: string;
	text: string;
	enabled: boolean;
	charsPerSecond?: number;
	onConsume?: (entryId: string) => void;
};

export function TypewriterMarkdown({ entryId, text, enabled, charsPerSecond, onConsume, ...markdownProps }: TypewriterMarkdownProps) {
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
	const visibleCountRef = useRef(0);
	const [visibleCount, setVisibleCount] = useState(() => (animate ? 0 : text.length));

	useEffect(() => {
		textRef.current = text;
		// If we aren't animating, always show the full current text.
		if (!animate) setVisibleCount(text.length);
	}, [animate, text]);

	useEffect(() => {
		visibleCountRef.current = visibleCount;
	}, [visibleCount]);

	useEffect(() => {
		if (!animate) return;
		const handle = window.setInterval(() => {
			// Start the clock when we have something to print; avoids "skipping ahead" if content arrives later.
			if (startMsRef.current == null) {
				if (textRef.current.length === 0) return;
				startMsRef.current = performance.now();
			}

			const elapsedMs = performance.now() - (startMsRef.current ?? performance.now());
			const targetLen = textRef.current.length;
			const ideal = Math.floor((elapsedMs * cps) / 1000);
			const nextLen = Math.min(targetLen, ideal);
			if (nextLen > visibleCountRef.current) {
				visibleCountRef.current = nextLen;
				setVisibleCount(nextLen);
			}
		}, TICK_MS);
		return () => window.clearInterval(handle);
	}, [animate, cps]);

	const displayText = animate ? text.slice(0, visibleCount) : text;
	return <ChatMarkdown text={displayText} {...markdownProps} />;
}
