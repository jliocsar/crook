import { describe, expect, it } from '@effect/vitest'
import { render, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { beforeEach, vi } from 'vitest'

import { InstallGate } from '@crook/web/install/InstallGate'

import { click } from '../Dom.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1'

const asPhone = (userAgent: string, matching: readonly string[] = []) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(5)
  stubMediaQueries(['(prefers-reduced-motion)', ...matching])
}

const renderGate = () => render(<InstallGate>crook itself</InstallGate>)

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('InstallGate', () => {
  it('asks Safari users to add crook to the Home Screen', () => {
    asPhone(IPHONE_SAFARI)
    renderGate()

    expect(screen.getByRole('heading', { name: 'Add crook to your Home Screen' })).not.toBeNull()
    expect(screen.getByText('Tap Share in the toolbar')).not.toBeNull()
    expect(screen.getByText("Can't see it? Tap ⋯ first.")).not.toBeNull()
    expect(screen.getByText('Open crook from your Home Screen')).not.toBeNull()
    expect(screen.queryByText('crook itself')).toBeNull()
  })

  it('gives Chrome its own first step', () => {
    asPhone(IPHONE_CHROME)
    renderGate()

    expect(screen.getByText('Tap Share in the address bar')).not.toBeNull()
    expect(screen.queryByText("Can't see it? Tap ⋯ first.")).toBeNull()
  })

  it.effect('carries on into crook, and stays out of the way for the session', () =>
    Effect.gen(function* () {
      asPhone(IPHONE_SAFARI)
      const { unmount } = renderGate()

      yield* click(screen.getByRole('button', { name: 'Continue in browser' }))

      expect(screen.getByText('crook itself')).not.toBeNull()

      unmount()
      renderGate()

      expect(screen.getByText('crook itself')).not.toBeNull()
    }),
  )

  it('goes straight into crook from the Home Screen', () => {
    asPhone(IPHONE_SAFARI, ['(display-mode: standalone)'])
    renderGate()

    expect(screen.getByText('crook itself')).not.toBeNull()
  })
})
