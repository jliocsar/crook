import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

export type InstallBrowser = 'safari' | 'chrome'

export type InstallEnvironment = {
  readonly userAgent: string
  readonly maxTouchPoints: number
  readonly standalone: boolean
}

const APPLE_HANDHELD = /\b(?:iPhone|iPad|iPod)\b/u
const APPLE_DESKTOP_CLASS = /\bMacintosh\b/u
const CHROME_ON_IOS = /\bCriOS\//u
const OTHER_IOS_BROWSER = /\b(?:FxiOS|EdgiOS|OPiOS|GSA|DuckDuckGo)\//u
const SAFARI = /\bVersion\/[\d.]+.*\bSafari\//u

const isAppleTouchDevice = ({ userAgent, maxTouchPoints }: InstallEnvironment): boolean =>
  APPLE_HANDHELD.test(userAgent) || (APPLE_DESKTOP_CLASS.test(userAgent) && maxTouchPoints > 1)

const browserOf = (userAgent: string): Option.Option<InstallBrowser> => {
  if (CHROME_ON_IOS.test(userAgent)) {
    return Option.some('chrome')
  }

  if (OTHER_IOS_BROWSER.test(userAgent)) {
    return Option.none()
  }

  return SAFARI.test(userAgent) ? Option.some('safari') : Option.none()
}

export const installBrowser = (environment: InstallEnvironment): Option.Option<InstallBrowser> =>
  pipe(
    Option.liftPredicate(environment, (candidate) => !candidate.standalone),
    Option.filter(isAppleTouchDevice),
    Option.flatMap(({ userAgent }) => browserOf(userAgent)),
  )
