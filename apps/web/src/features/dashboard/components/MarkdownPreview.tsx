/**
 * MarkdownPreview — renders a report's markdown export inline.
 *
 * Uses react-markdown WITHOUT rehype-raw, so raw HTML in the source is never
 * injected into the DOM, and its default urlTransform blocks non-safe link
 * protocols. remark-gfm enables the pipe tables used by the H12 reports.
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-preview text-sm text-slate-300 leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
