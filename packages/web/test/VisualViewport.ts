import { act } from '@testing-library/react'

type ViewportBox = { height: number; offsetTop: number; scale: number }

export type FakeVisualViewport = EventTarget & ViewportBox

export const emulateVisualViewport = (): FakeVisualViewport => {
  const viewport = Object.assign(new EventTarget(), {
    height: window.innerHeight,
    offsetTop: 0,
    scale: 1,
  })

  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })

  return viewport
}

export const forgetVisualViewport = (): void => {
  Reflect.deleteProperty(window, 'visualViewport')
}

export const moveVisualViewport = (
  viewport: FakeVisualViewport,
  change: Partial<ViewportBox>,
  type: 'resize' | 'scroll' = 'resize',
): void => {
  act(() => {
    Object.assign(viewport, change)
    viewport.dispatchEvent(new Event(type))
  })
}
