import { act, fireEvent, render } from '@testing-library/react'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as React from 'react'
import { vi } from 'vitest'

import { Thread } from '@crook/web/chat/Thread'
import type { ThreadHandle, ThreadRow } from '@crook/web/chat/Thread'

import { bottomOf, present, wait } from './Dom.ts'

const VIEWPORT_WIDTH = 375
const HISTORY_HEIGHT = 1000

export const VIEWPORT_HEIGHT = 812
export const SETTLE_MS = 400

const row = (key: string): ThreadRow => ({ key, content: <p>{key}</p> })

const WORKING: ThreadRow = { key: 'working', content: <p>Working</p>, placeholder: true }

const thread = (rows: readonly ThreadRow[], handle: React.Ref<ThreadHandle>) => (
  <Thread handle={handle} rows={rows} dimmed={false} empty={<p>No messages yet</p>} />
)

const viewport = (): HTMLElement =>
  present(document.querySelector<HTMLElement>('[data-slot="conversation-viewport"]'), 'the thread')

export const phoneViewport = (): void => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT)
}

export const fades = (key: string): boolean =>
  present(document.querySelector(`[data-row="${key}"]`), `the ${key} row`).querySelector(
    '[style*="opacity"]',
  ) !== null

export const ghost = (): Element | null => document.querySelector('[data-slot="thread-ghost"]')

export const liftOf = (): string =>
  present(
    document.querySelector<HTMLElement>('[data-slot="conversation-content"]'),
    'the thread content',
  ).style.transform

export const lifted = (): number => {
  const pixels = Number.parseFloat(liftOf().replace('translateY(', ''))

  return Number.isNaN(pixels) ? 0 : pixels
}

export const liftsWritten = (): (() => readonly number[]) => {
  const seen: number[] = []
  const observer = new MutationObserver(() => {
    seen.push(lifted())
  })

  observer.observe(
    present(
      document.querySelector<HTMLElement>('[data-slot="conversation-content"]'),
      'the thread content',
    ),
    { attributes: true, attributeFilter: ['style'] },
  )

  return () => {
    observer.disconnect()

    return seen
  }
}

export const following = (): boolean => viewport().hasAttribute('data-following')

export const openedOn = (keys: readonly string[]) => {
  render(thread(keys.map(row), null))
}

export const scrollsUnderLift = (added: number): void => {
  const scrolling = viewport()
  const lift = lifted()

  Object.defineProperty(scrolling, 'scrollHeight', {
    configurable: true,
    get: () => HISTORY_HEIGHT + added + lift,
  })
  fireEvent.scroll(scrolling)
}

const scrollable = (scrolling: HTMLElement) => {
  let height = HISTORY_HEIGHT
  let top = 0

  Object.defineProperty(scrolling, 'scrollHeight', {
    configurable: true,
    get: () => height + lifted(),
  })
  Object.defineProperty(scrolling, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (next: number) => {
      top = Math.max(0, Math.min(next, bottomOf(scrolling)))
    },
  })
  scrolling.scrollTop = HISTORY_HEIGHT

  return {
    grow: (added: number) => {
      height += added
    },
    bottom: () => height - scrolling.clientHeight,
  }
}

export const liveTail = Effect.fn('liveTail')(function* () {
  const { rerender } = render(thread([row('prompt'), WORKING], null))
  const { grow } = scrollable(viewport())

  yield* wait(SETTLE_MS)

  return {
    lands: (keys: readonly string[], added: number) => {
      grow(added)
      rerender(thread([row('prompt'), ...keys.map(row)], null))
    },
  }
})

export const answerGrows = Effect.fn('answerGrows')(function* (added: number) {
  const tail = yield* liveTail()

  tail.lands(['text', 'tool'], added)
})

export const historyOpen = () => {
  const history = [row('prompt'), row('text')]
  const handle = React.createRef<ThreadHandle>()
  const { rerender } = render(thread(history, handle))
  const scrolling = viewport()
  const { grow, bottom } = scrollable(scrolling)

  fireEvent.scroll(scrolling)

  const movesUp = (by: number) => {
    scrolling.scrollTop -= by
    fireEvent.scroll(scrolling)
  }

  return {
    top: () => scrolling.scrollTop,
    bottom,
    fingerScrollsUp: (by: number) => {
      fireEvent.touchStart(scrolling)
      movesUp(by)
      fireEvent.touchEnd(scrolling)
    },
    mouseDragsUp: (by: number) => {
      fireEvent.pointerDown(scrolling, { pointerType: 'mouse' })
      movesUp(by)
      fireEvent.pointerUp(scrolling, { pointerType: 'mouse' })
    },
    mouseReleasedOutside: () => {
      fireEvent.pointerDown(scrolling, { pointerType: 'mouse' })
      fireEvent.pointerUp(document.body, { pointerType: 'mouse' })
    },
    clicked: () => {
      fireEvent.pointerDown(scrolling, { pointerType: 'mouse' })
      fireEvent.pointerUp(scrolling, { pointerType: 'mouse' })
    },
    wheelsUp: (by: number) => {
      fireEvent.wheel(scrolling)
      movesUp(by)
    },
    correctedUp: movesUp,
    jumpsTo: (key: string) => {
      handle.current?.scrollToKey(key)
    },
    pressesLatest: () => {
      fireEvent.click(
        present(
          document.querySelector<HTMLElement>('[data-slot="conversation-jump"]'),
          'the Latest button',
        ),
      )
    },
    growsBelow: (added: number) => {
      grow(added)
      fireEvent.scroll(scrolling)
    },
    sends: (added: number) => {
      handle.current?.scrollToEnd()
      grow(added)
      rerender(thread([...history, row('sent')], handle))
    },
  }
}

const heldMeasurements = (rowHeight: number) => {
  const observed = new Set<Element>()
  const reports = new Set<ResizeObserverCallback>()

  class HeldResizeObserver {
    constructor(report: ResizeObserverCallback) {
      reports.add(report)
    }

    observe(target: Element) {
      observed.add(target)
    }

    unobserve(target: Element) {
      observed.delete(target)
    }

    disconnect() {}
  }

  const rows = () => Arr.filter([...observed], (target) => target.hasAttribute('data-index'))

  return {
    HeldResizeObserver,
    deliver: () => {
      const entries = Arr.map(rows(), (target) => ({
        target,
        borderBoxSize: [{ blockSize: rowHeight, inlineSize: VIEWPORT_WIDTH }],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
        contentRect: new DOMRect(0, 0, VIEWPORT_WIDTH, rowHeight),
      }))

      for (const report of reports) {
        report(entries, new HeldResizeObserver(report))
      }
    },
  }
}

export const rowsShrinkAfterOpen = (
  count: number,
  renderedHeight: number,
  measuredHeight: number,
) => {
  const measurements = heldMeasurements(measuredHeight)

  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function rendered(this: HTMLElement) {
      return this.hasAttribute('data-index') ? renderedHeight : 0
    },
  )

  vi.stubGlobal('ResizeObserver', measurements.HeldResizeObserver)
  render(
    thread(
      Arr.makeBy(count, (index) => row(`row ${index}`)),
      null,
    ),
  )

  const scrolling = viewport()

  Object.defineProperty(scrolling, 'scrollHeight', {
    configurable: true,
    get: () =>
      Number.parseFloat(
        present(
          scrolling.querySelector<HTMLElement>('[data-slot="conversation-content"]'),
          'the thread content',
        ).style.height,
      ),
  })

  const corrections = vi.spyOn(scrolling, 'scrollTo')

  scrolling.scrollTop = bottomOf(scrolling)
  fireEvent.scroll(scrolling)

  return {
    measured: () => {
      act(() => {
        measurements.deliver()
      })
      fireEvent.scroll(scrolling)
    },
    corrections: () => corrections.mock.calls.length,
    top: () => scrolling.scrollTop,
    bottom: () => bottomOf(scrolling),
  }
}
