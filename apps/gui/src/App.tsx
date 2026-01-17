import './index.css';

import { CodexChat } from './components/CodexChat';

export default function App() {
	return (
		<div className="flex h-full flex-col bg-bg-app text-text-main">
			<header className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-2">
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold">AgentMesh</div>
					<div className="truncate text-[11px] text-text-muted">Codex Chat</div>
				</div>
			</header>

			<main className="min-h-0 flex-1">
				<CodexChat />
			</main>
		</div>
	);
}
