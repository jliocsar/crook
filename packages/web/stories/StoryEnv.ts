import * as Option from 'effect/Option'

import { START } from '../test/HerdFixtures.ts'
import type { StoryEnv } from './Story.tsx'

type StoryEnvValue = boolean | number | string | EventTarget

const MOTION_QUERY = '(prefers-reduced-motion)'
const CLOCK_AFTER_START_MS = 5 * 60 * 1000
const KEYBOARD_HEIGHT = 336
const KEYBOARD_ELEMENT_ID = 'story-keyboard'

const defineOn = (target: Navigator | Window, property: string, value: StoryEnvValue): void => {
  Object.defineProperty(target, property, { configurable: true, value })
}

export const startClockAtFixtures = (): void => {
  // oxlint-disable-next-line effecttsgo/global-date-in-effect, effecttsgo/global-date
  const realNow = Date.now.bind(Date)
  const offset = START.epochMilliseconds + CLOCK_AFTER_START_MS - realNow()

  // oxlint-disable-next-line effecttsgo/global-date-in-effect, effecttsgo/global-date
  Date.now = () => realNow() + offset
}

export const emulateKeyboard = (up: boolean): void => {
  const viewport = Object.assign(new EventTarget(), {
    height: up ? window.innerHeight - KEYBOARD_HEIGHT : window.innerHeight,
    width: window.innerWidth,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 1,
  })

  defineOn(window, 'visualViewport', viewport)
  document.getElementById(KEYBOARD_ELEMENT_ID)?.remove()

  if (up) {
    const keyboard = document.body.appendChild(document.createElement('div'))

    keyboard.id = KEYBOARD_ELEMENT_ID
    keyboard.setAttribute('aria-hidden', 'true')
    keyboard.style.cssText = `position:fixed;inset:auto 0 0 0;height:${KEYBOARD_HEIGHT}px;z-index:2147483646;background:#d1d5db;`
  }
}

export const applyStoryEnv = (env: StoryEnv): void => {
  sessionStorage.clear()
  defineOn(navigator, 'standalone', env.standalone)
  Option.map(env.userAgent, (userAgent) => {
    defineOn(navigator, 'userAgent', userAgent)
  })
  Option.map(env.maxTouchPoints, (points) => {
    defineOn(navigator, 'maxTouchPoints', points)
  })

  if (env.reducedMotion) {
    const realMatchMedia = window.matchMedia.bind(window)

    window.matchMedia = (query) =>
      Object.defineProperty(realMatchMedia(query), 'matches', {
        value: query === MOTION_QUERY ? true : realMatchMedia(query).matches,
      })
  }

  if (env.keyboardUp) {
    emulateKeyboard(true)
  }
}
