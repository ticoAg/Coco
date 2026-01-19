import ReactMarkdown from 'react-markdown';

const isMarkdownFile = (path?: string | null) => Boolean(path && path.toLowerCase().endsWith('.md'));
const isHtmlFile = (path?: string | null) => {
	if (!path) return false;
	const lower = path.toLowerCase();
	return lower.endsWith('.html') || lower.endsWith('.htm');
};

type TextPreviewProps = {
	content: string;
	path: string;
	allowHtml?: boolean;
	markdownClassName?: string;
	htmlClassName?: string;
	preClassName?: string;
};

export function TextPreview({
	content,
	path,
	allowHtml = true,
	markdownClassName = 'space-y-3 text-sm text-text-main',
	htmlClassName = 'h-[560px] w-full rounded-md border border-white/10 bg-black/20',
	preClassName = 'max-h-[560px] overflow-auto rounded-md bg-black/20 p-3 text-xs text-text-muted',
}: TextPreviewProps) {
	if (isMarkdownFile(path)) {
		return (
			<div className={markdownClassName}>
				<ReactMarkdown>{content}</ReactMarkdown>
			</div>
		);
	}
	if (allowHtml && isHtmlFile(path)) {
		return <iframe title="HTML preview" sandbox="" className={htmlClassName} srcDoc={content} />;
	}
	return <pre className={preClassName}>{content}</pre>;
}

export default TextPreview;
