import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusGlyph } from '@crook/web/components/StatusGlyph'

const circle = (container: HTMLElement) =>
  container.querySelector('[data-slot="status-glyph"] > [aria-hidden="true"]')

describe('StatusGlyph', () => {
  it('says a blocked agent needs you beside a hand, in the warning tone', () => {
    const { container } = render(<StatusGlyph status="blocked" />)

    expect(container.textContent).toBe('needs you')
    expect(circle(container)?.className).toContain('bg-warning/15')
    expect(circle(container)?.querySelector('svg')).not.toBeNull()
  })

  it('spins the working glyph in CSS and stops for reduced motion', () => {
    const { container } = render(<StatusGlyph status="working" />)
    const icon = circle(container)?.querySelector('svg')

    expect(container.textContent).toBe('working')
    expect(icon?.getAttribute('class')).toContain('animate-spin')
    expect(icon?.getAttribute('class')).toContain('motion-reduce:animate-none')
  })

  it('hides the glyph from screen readers, since the word carries the state', () => {
    const { container } = render(<StatusGlyph status="done" />)

    expect(circle(container)?.getAttribute('aria-hidden')).toBe('true')
    expect(container.textContent).toBe('done')
  })

  it('swaps to the new status when it changes', () => {
    const { container, rerender } = render(<StatusGlyph status="working" />)

    rerender(<StatusGlyph status="idle" />)

    expect(container.querySelector('[data-status="idle"]')).not.toBeNull()
  })
})
