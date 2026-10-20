import { screen, waitFor } from '@testing-library/react'
import type { ByRoleMatcher } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as Effect from 'effect/Effect'

export const click = (element: Element) => Effect.promise(() => userEvent.click(element))

export const findByRole = (role: ByRoleMatcher, name: string) =>
  Effect.promise(() => screen.findByRole(role, { name }))

export const eventually = (assertion: () => void) => Effect.promise(() => waitFor(assertion))
