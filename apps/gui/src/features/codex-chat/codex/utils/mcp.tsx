import type React from 'react';
import { ChatMarkdown } from '../ChatMarkdown';
import type { McpContentBlock, McpToolCallError, McpToolCallResult } from '@/types/codex';
import { isRecord, safeString } from './formatters';

function truncatePreview(value: string, max = 60): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
	return value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function formatPrimitive(value: unknown): string {
	if (typeof value === 'string') return truncatePreview(JSON.stringify(value));
	if (value == null) return 'null';
	return String(value);
}

export function stringifyJsonSafe(value: unknown, indent = 2): string {
	try {
		return JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val), indent) ?? 'null';
	} catch {
		try {
			return String(value);
		} catch {
			return '';
		}
	}
}

export function formatMcpArgsPreview(args: unknown): string {
	if (args == null) return '';
	if (typeof args !== 'object' || Array.isArray(args)) {
		return truncatePreview(String(args));
	}

	try {
		const values = Object.values(args as Record<string, unknown>);
		if (values.length === 0) return '';
		const first = values[0];
		if (values.length === 1 && isPrimitive(first)) return formatPrimitive(first);
		const json = stringifyJsonSafe(args);
		return truncatePreview(json);
	} catch {
		return '';
	}
}

function normalizeMcpContentBlock(block: unknown): McpContentBlock | null {
	if (!isRecord(block)) return null;
	const type = safeString(block.type);
	if (!type) return null;
	return block as McpContentBlock;
}

export function mcpContentToText(blocks: unknown[]): string {
	const parts: string[] = [];
	for (const raw of blocks) {
		const block = normalizeMcpContentBlock(raw);
		if (!block) {
			const fallback = stringifyJsonSafe(raw);
			if (fallback) parts.push(fallback);
			continue;
		}
		if (block.type === 'text') {
			parts.push(block.text);
			continue;
		}
		if (block.type === 'resource_link') {
			const title = block.title || block.name || '';
			const uri = block.uri || '';
			parts.push([title, uri].filter(Boolean).join('\n'));
			continue;
		}
		if (block.type === 'resource' || block.type === 'embedded_resource') {
			const resource = block.resource ?? ({} as { uri?: string; text?: string; blob?: string });
			if (resource.text) {
				parts.push(resource.text);
			} else if (resource.blob) {
				parts.push(`[embedded resource blob: ${resource.blob.length} bytes]`);
			} else if (resource.uri) {
				parts.push(resource.uri);
			}
			continue;
		}
		if (block.type === 'image' || block.type === 'audio') {
			const mime = block.mimeType || '';
			const size = block.data?.length ?? 0;
			parts.push(`[${block.type} ${mime} ${size} bytes]`);
			continue;
		}
		const fallback = stringifyJsonSafe(block);
		if (fallback) parts.push(fallback);
	}
	return parts.filter(Boolean).join('\n\n');
}

export function renderMcpContentBlocks(blocks: unknown[]): React.ReactNode {
	if (!Array.isArray(blocks) || blocks.length === 0) return null;
	return (
		<div className="space-y-2 whitespace-normal font-sans text-[11px] text-text-muted">
			{blocks.map((raw, idx) => {
				const block = normalizeMcpContentBlock(raw);
				if (!block) {
					return (
						<pre key={`mcp-raw-${idx}`} className="whitespace-pre-wrap break-words rounded-md bg-white/5 px-2 py-1 text-[10px]">
							{stringifyJsonSafe(raw)}
						</pre>
					);
				}
				if (block.type === 'text') {
					return <ChatMarkdown key={`mcp-text-${idx}`} text={block.text} className="text-[11px] text-text-muted" dense />;
				}
				if (block.type === 'image') {
					const mime = block.mimeType || 'image/png';
					const src = `data:${mime};base64,${block.data ?? ''}`;
					return <img key={`mcp-image-${idx}`} className="max-h-48 w-max max-w-full rounded-md object-contain" src={src} alt="" />;
				}
				if (block.type === 'audio') {
					const mime = block.mimeType || 'audio/mpeg';
					const src = `data:${mime};base64,${block.data ?? ''}`;
					return <audio key={`mcp-audio-${idx}`} className="w-full" controls src={src} preload="metadata" />;
				}
				if (block.type === 'resource_link') {
					const title = block.title || block.name;
					return (
						<div key={`mcp-link-${idx}`} className="space-y-1 rounded-md bg-white/5 px-2 py-1">
							<div className="text-[10px] font-medium text-text-muted">{title}</div>
							{block.description ? <div className="text-[10px] leading-relaxed text-text-muted">{block.description}</div> : null}
							<a className="block break-all text-[10px] text-blue-400 underline" href={block.uri} target="_blank" rel="noreferrer">
								{block.uri}
							</a>
							{block.mimeType ? <div className="text-[9px] text-text-muted">{block.mimeType}</div> : null}
						</div>
					);
				}
				if (block.type === 'resource' || block.type === 'embedded_resource') {
					const resource = block.resource ?? { uri: '' };
					const mimeType = resource.mimeType ?? '';
					const text = resource.text ?? '';
					const blob = resource.blob ?? '';
					return (
						<div key={`mcp-resource-${idx}`} className="space-y-1 rounded-md bg-white/5 px-2 py-1">
							{resource.uri ? (
								<div className="text-[10px] text-text-muted">
									<span className="font-medium">URI:</span> <span className="break-all text-text-muted">{resource.uri}</span>
								</div>
							) : null}
							{mimeType ? <div className="text-[9px] text-text-muted">MIME: {mimeType}</div> : null}
							{text ? (
								<pre className="whitespace-pre-wrap break-words rounded-md bg-black/20 px-2 py-1 text-[10px] text-text-muted">{text}</pre>
							) : blob ? (
								<div className="text-[10px] text-text-muted">Embedded binary ({blob.length} bytes)</div>
							) : null}
						</div>
					);
				}
				return (
					<pre key={`mcp-unknown-${idx}`} className="whitespace-pre-wrap break-words rounded-md bg-white/5 px-2 py-1 text-[10px]">
						{stringifyJsonSafe(block)}
					</pre>
				);
			})}
		</div>
	);
}

export function normalizeMcpResult(value: unknown): McpToolCallResult | null {
	if (!isRecord(value)) return null;
	const contentRaw = value.content;
	const content = Array.isArray(contentRaw) ? (contentRaw as McpContentBlock[]) : [];
	const structuredContent =
		(value as { structuredContent?: unknown; structured_content?: unknown }).structuredContent ??
		(value as { structuredContent?: unknown; structured_content?: unknown }).structured_content ??
		null;
	return { content, structuredContent };
}

export function normalizeMcpError(value: unknown): McpToolCallError | null {
	if (!isRecord(value)) return null;
	const message = safeString(value.message);
	if (!message) return null;
	return { message };
}
