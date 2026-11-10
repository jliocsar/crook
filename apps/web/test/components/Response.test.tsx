import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Response } from '@crook/web/components/ui/response'

const MARKDOWN = 'Read [the guide](https://example.com/guide) first.\n\n```ts\nconst herd = 1\n```'

const renderFenced = (code: string) => <code data-fenced="">{code}</code>

const nodesOf = (container: HTMLElement) => ({
  link: container.querySelector('a'),
  code: container.querySelector('[data-fenced]'),
})

describe('Response', () => {
  it('keeps its link and code block when the thread renders it again', () => {
    const { container, rerender } = render(
      <Response renderCode={renderFenced}>{MARKDOWN}</Response>,
    )
    const before = nodesOf(container)

    rerender(<Response renderCode={renderFenced}>{MARKDOWN}</Response>)

    expect(before.link).not.toBeNull()
    expect(before.code).not.toBeNull()
    expect(nodesOf(container).link).toBe(before.link)
    expect(nodesOf(container).code).toBe(before.code)
  })

  it('keeps them when a prop around the text changes and the markdown renders again', () => {
    const { container, rerender } = render(
      <Response renderCode={renderFenced}>{MARKDOWN}</Response>,
    )
    const before = nodesOf(container)

    rerender(
      <Response renderCode={renderFenced} className="text-destructive">
        {MARKDOWN}
      </Response>,
    )

    expect(nodesOf(container).link).toBe(before.link)
    expect(nodesOf(container).code).toBe(before.code)
  })
})
