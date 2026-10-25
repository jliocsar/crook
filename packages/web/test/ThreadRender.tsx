import { fireEvent, render } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { vi } from 'vitest'

import { Thread } from '@crook/web/chat/Thread'
import type { ThreadRow } from '@crook/web/chat/Thread'

import { present, wait } from './Dom.ts'

const SETTLE_MS = 400
const VIEWPORT_WIDTH = 375
const HISTORY_HEIGHT = 1000

export const VIEWPORT_HEIGHT = 812

const row = (key: string): ThreadRow => ({ key, content: <p>{key}</p> })

const WORKING: ThreadRow = { key: 'working', content: <p>Working</p>, placeholder: true }

const thread = (rows: readonly ThreadRow[]) => (
  <Thread rows={rows} dimmed={false} empty={<p>No messages yet</p>} />
)

const viewport = (): HTMLElement =>
  present(document.querySelector<HTMLElement>('[data-slot="conversation-viewport"]'), 'the thread')

export const phoneViewport = (): void => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT)
}

export const revealOf = (key: string): string | null =>
  present(document.querySelector(`[data-row="${key}"] .min-w-0`), `the ${key} row`).getAttribute(
    'data-reveal',
  )

export const ghost = (): Element | null => document.querySelector('[data-slot="thread-ghost"]')

export const liftOf = (): string =>
  present(
    document.querySelector<HTMLElement>('[data-slot="conversation-content"]'),
    'the thread content',
  ).style.transform

export const following = (): boolean => viewport().hasAttribute('data-following')

export const openedOn = (keys: readonly string[]) => {
  render(thread(keys.map(row)))
}

export const scrollsUnderLift = (added: number): void => {
  const scrolling = viewport()
  const lift = Number.parseFloat(liftOf().replace('translateY(', ''))

  Object.defineProperty(scrolling, 'scrollHeight', {
    configurable: true,
    get: () => HISTORY_HEIGHT + added + lift,
  })
  fireEvent.scroll(scrolling)
}

export const answerGrows = Effect.fn('answerGrows')(function* (added: number) {
  const { rerender } = render(thread([row('prompt'), WORKING]))
  const scrolling = viewport()
  let height = HISTORY_HEIGHT
  let top = 0

  Object.defineProperty(scrolling, 'scrollHeight', { configurable: true, get: () => height })
  Object.defineProperty(scrolling, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (next: number) => {
      top = Math.max(0, Math.min(next, height - scrolling.clientHeight))
    },
  })
  scrolling.scrollTop = HISTORY_HEIGHT
  yield* wait(SETTLE_MS)
  height = HISTORY_HEIGHT + added
  rerender(thread([row('prompt'), row('text'), row('tool')]))
})
