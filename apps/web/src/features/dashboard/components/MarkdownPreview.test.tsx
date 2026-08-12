// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MarkdownPreview } from './MarkdownPreview'

/**
 * MarkdownPreview tests:
 *   - renders headings, inline emphasis, and GFM pipe tables
 *   - never injects raw HTML (react-markdown without rehypeRaw converts
 *     raw HTML nodes into plain text)
 *   - never emits anchors with unsafe URL protocols
 */
afterEach(() => cleanup())

describe('MarkdownPreview', () => {
  it('renders headings, bold text, and GFM tables', () => {
    render(
      <MarkdownPreview
        content={
          '# Executive Report\n\n**bold** emphasis\n\n| KPI | Value |\n| --- | --- |\n| pm_acceptance_rate | 0.5 |'
        }
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Executive Report' })).toBeTruthy()
    expect(screen.getByText('bold')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('KPI')).toBeTruthy()
    expect(screen.getByText('pm_acceptance_rate')).toBeTruthy()
    expect(screen.getByText('0.5')).toBeTruthy()
  })

  it('does not inject raw HTML from the markdown source', () => {
    const content = '<script>window.__markdownPwned = true</script>Hello'
    render(<MarkdownPreview content={content} />)

    // The script must not become a DOM element, and its source is shown as
    // inert text rather than executed.
    expect(document.querySelector('script')).toBeNull()
    expect(screen.queryByText(/Hello/)).toBeTruthy()
    expect(screen.queryByText(/window\.__markdownPwned/)).toBeTruthy()
  })

  it('strips unsafe link protocols such as javascript:', () => {
    render(<MarkdownPreview content="[click me](javascript:alert(1))" />)

    const anchors = Array.from(document.querySelectorAll('a'))
    expect(anchors.every((a) => !(a.getAttribute('href') ?? '').startsWith('javascript:'))).toBe(
      true
    )
  })
})
