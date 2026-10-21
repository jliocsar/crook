import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Input } from '@crook/web/components/ui/input'

const fieldClasses = (container: HTMLElement) =>
  (container.querySelector('input')?.className ?? '').split(' ')

describe('Input', () => {
  it('shows at 44px, the height of a touch button beside it', () => {
    const { container } = render(<Input aria-label="Agent name" />)

    expect(fieldClasses(container)).toContain('h-11')
    expect(fieldClasses(container)).not.toContain('h-8')
  })

  it('keeps its text at 16px at every width, so iOS never zooms on focus', () => {
    const { container } = render(<Input aria-label="Agent name" />)

    expect(fieldClasses(container)).toContain('text-base')
    expect(fieldClasses(container)).not.toContain('md:text-sm')
  })

  it('adds a caller class without dropping its own', () => {
    const { container } = render(<Input aria-label="Folder" className="font-mono" />)

    expect(fieldClasses(container)).toContain('font-mono')
    expect(fieldClasses(container)).toContain('h-11')
  })
})
