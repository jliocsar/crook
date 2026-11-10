import * as Option from 'effect/Option'
import { describe, expect, it } from 'vitest'

import { installBrowser } from '@crook/web/install/InstallBrowser'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1'
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15'
const IPHONE_IN_APP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36'

const inBrowser = (userAgent: string, maxTouchPoints = 5) =>
  installBrowser({ userAgent, maxTouchPoints, standalone: false })

describe('installBrowser', () => {
  it('picks the Safari steps on an iPhone in Safari', () => {
    expect(inBrowser(IPHONE_SAFARI)).toStrictEqual(Option.some('safari'))
  })

  it('picks the Chrome steps on an iPhone in Chrome', () => {
    expect(inBrowser(IPHONE_CHROME)).toStrictEqual(Option.some('chrome'))
  })

  it('treats an iPad asking for the desktop site as Safari', () => {
    expect(inBrowser(MAC_SAFARI)).toStrictEqual(Option.some('safari'))
  })

  it('shows nothing where no steps were designed', () => {
    expect(inBrowser(IPHONE_FIREFOX)).toStrictEqual(Option.none())
    expect(inBrowser(IPHONE_IN_APP)).toStrictEqual(Option.none())
    expect(inBrowser(MAC_SAFARI, 0)).toStrictEqual(Option.none())
    expect(inBrowser(ANDROID_CHROME)).toStrictEqual(Option.none())
  })

  it('shows nothing once crook runs from the Home Screen', () => {
    expect(
      installBrowser({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5, standalone: true }),
    ).toStrictEqual(Option.none())
  })
})
