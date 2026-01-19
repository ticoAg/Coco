# Change: Align Codex Chat assistant-message data mapping & UI to VSCode Codex plugin

## Why
CodexChat currently renders agent messages without the VSCode plugin’s structured-output parsing, placeholder streaming behavior, and final-assistant grouping rules. This causes visible drift from the target UI/UX and breaks expected Code Review rendering.

## What Changes
- Align assistant-message data mapping to plugin logic (placeholder streaming, structured output parsing).
- Render Code Review structured output with Finding cards + priority (Open/Fix actions intentionally omitted).
- Apply plugin grouping rule: only the last assistant-message is treated as the final reply; earlier assistant-messages stay in Working.
- Surface stream/system error messages in Working with plugin-equivalent grouping/visibility.

## Impact
- Affected specs: [`openspec/specs/gui-codex-chat/spec.md`](../../../specs/gui-codex-chat/spec.md)
- Affected code: [`apps/gui/src/components/CodexChat.tsx`](../../../../apps/gui/src/components/CodexChat.tsx), [`apps/gui/src/types/codex.ts`](../../../../apps/gui/src/types/codex.ts) (new/extended item types), and new Codex UI components under `apps/gui/src/components/codex/*`.
