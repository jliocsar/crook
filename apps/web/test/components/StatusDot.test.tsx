import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusDot } from '@crook/web/components/StatusDot'

const innerDot = (container: HTMLElement) =>
  container.querySelector('[data-status] > span')?.className ?? ''

describe('StatusDot', () => {
  it('halos the blocked dot so it survives colour blindness', () => {
    const { container } = render(<StatusDot status="blocked" />)

    expect(innerDot(container)).toContain('ring-2')
    expect(innerDot(container)).toContain('ring-warning/35')
  })

  it('pulses the working dot in CSS and stops for reduced motion', () => {
    const { container } = render(<StatusDot status="working" />)

    expect(innerDot(container)).toContain('animate-pulse')
    expect(innerDot(container)).toContain('motion-reduce:animate-none')
  })

  it('is hidden from screen readers, since the word carries the state', () => {
    const { container } = render(<StatusDot status="done" />)

    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
    expect(innerDot(container)).toContain('bg-accent')
  })

  it('swaps to the new status when it changes', () => {
    const { container, rerender } = render(<StatusDot status="working" />)

    rerender(<StatusDot status="idle" />)

    expect(container.querySelector('[data-status="idle"]')).not.toBeNull()
  })
})
