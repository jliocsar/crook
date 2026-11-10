import { describe, expect, it } from '@effect/vitest'
import { cleanup, render } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach } from 'vitest'

import { MeasuredSkeleton } from '@crook/web/components/MeasuredSkeleton'

const styleSheetLoaded = () => {
  document.documentElement.style.setProperty('--skullet', '1')
}

beforeEach(styleSheetLoaded)

afterEach(() => {
  cleanup()
  document.documentElement.style.removeProperty('--skullet')
  localStorage.clear()
})

describe('a measured skeleton', () => {
  it.effect('adds nothing a strict style policy refuses, and remembers nothing', () =>
    Effect.sync(() => {
      const before = document.querySelectorAll('style').length
      const { container } = render(
        <MeasuredSkeleton slot="sample-skeleton" label="Loading the sample">
          <p>A sample row</p>
        </MeasuredSkeleton>,
      )

      expect(document.querySelectorAll('style')).toHaveLength(before)
      expect(container.querySelectorAll('[style]')).toHaveLength(0)
      expect(localStorage.length).toBe(0)
    }),
  )

  it.effect('names itself once and hides its sample from everything else', () =>
    Effect.sync(() => {
      const { getByRole } = render(
        <MeasuredSkeleton slot="sample-skeleton" label="Loading the sample">
          <button type="button">A sample button</button>
        </MeasuredSkeleton>,
      )
      const status = getByRole('status')

      expect(status.textContent).toContain('Loading the sample')
      expect(status.querySelector('[aria-hidden="true"]')?.hasAttribute('inert')).toBe(true)
    }),
  )
})
