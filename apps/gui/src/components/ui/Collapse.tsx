import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export const ACCORDION_TRANSITION = {
	duration: 0.08,
	ease: [0.2, 0, 0, 1] as const,
};

export function Collapse(props: {
	open: boolean;
	children: React.ReactNode;
	className?: string;
	/**
	 * Put spacing (pt/pb/px) here instead of `className`.
	 * Avoid margins on the animated container to prevent "two-step" collapse gaps.
	 */
	innerClassName?: string;
}): JSX.Element {
	return (
		<AnimatePresence initial={false}>
			{props.open ? (
				<motion.div
					className={props.className}
					initial={{ height: 0 }}
					animate={{ height: 'auto' }}
					exit={{ height: 0 }}
					transition={ACCORDION_TRANSITION}
					style={{ overflow: 'hidden' }}
				>
					<div className={props.innerClassName}>{props.children}</div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
