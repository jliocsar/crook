import { useAtomValue } from '@effect/atom-react/Hooks'
import { RegistryProvider } from '@effect/atom-react/RegistryContext'
import { describe, expect, it } from '@effect/vitest'
import { cleanup, renderHook } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { afterEach } from 'vitest'

import { toastAtom } from '@crook/web/atoms/Toast'
import { useFailureToast } from '@crook/web/toast/FailureToast'

const FAILED = Option.some('The pin did not land.')
const NOT_FAILED = Option.none<string>()

const renderFailure = (first: Option.Option<string>) =>
  renderHook(
    ({ failure }) => {
      useFailureToast(failure)

      return useAtomValue(toastAtom)
    },
    { initialProps: { failure: first }, wrapper: RegistryProvider },
  )

afterEach(() => {
  cleanup()
})

describe('a failure as a toast', () => {
  it.effect('says nothing about a failure that landed before it mounted', () =>
    Effect.sync(() => {
      const { result } = renderFailure(FAILED)

      expect(Option.isNone(result.current)).toBe(true)
    }),
  )

  it.effect('shows a failure that lands while it is mounted', () =>
    Effect.sync(() => {
      const { result, rerender } = renderFailure(NOT_FAILED)

      rerender({ failure: FAILED })

      expect(Option.map(result.current, (toast) => toast.text)).toEqual(FAILED)
    }),
  )

  it.effect('shows the same failure again after a retry went through nothing failed', () =>
    Effect.sync(() => {
      const { result, rerender } = renderFailure(NOT_FAILED)

      rerender({ failure: FAILED })

      const first = Option.map(result.current, (toast) => toast.id)

      rerender({ failure: NOT_FAILED })
      rerender({ failure: FAILED })

      expect(Option.map(result.current, (toast) => toast.id)).not.toEqual(first)
    }),
  )
})
