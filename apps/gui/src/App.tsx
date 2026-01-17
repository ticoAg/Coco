import './index.css';

import { CodexChat } from './components/CodexChat';

export default function App() {
	return (
		<div className="flex h-full min-h-0 flex-col bg-bg-app text-text-main">
			<main className="min-h-0 flex-1">
				<CodexChat />
			</main>
		</div>
	);
}
