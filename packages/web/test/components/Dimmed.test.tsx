import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Dimmed } from '@crook/web/components/Dimmed'

const dimmedClass = (container: HTMLElement) => container.firstElementChild?.className ?? ''

describe('Dimmed', () => {
  it('comes back to full opacity as soon as it stops being dimmed, however briefly it was', () => {
    const { container, rerender } = render(<Dimmed dimmed>stale</Dimmed>)

    rerender(<Dimmed dimmed={false}>fresh</Dimmed>)

    expect(dimmedClass(container)).not.toContain('opacity-60')
    expect(dimmedClass(container)).toContain('transition-opacity')
  })

  it('fades what it holds while dimmed', () => {
    const { container } = render(<Dimmed dimmed>stale</Dimmed>)

    expect(dimmedClass(container)).toContain('opacity-60')
  })
})
