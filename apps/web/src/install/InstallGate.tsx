import * as Option from 'effect/Option'
import * as React from 'react'

import { installBrowser } from '@crook/web/install/InstallBrowser'
import { InstallScreen } from '@crook/web/install/InstallScreen'
import { isStandalone } from '@crook/web/install/Standalone'

const CONTINUED_KEY = 'crook.install.continued'
const CONTINUED = 'yes'

const readBrowser = () =>
  sessionStorage.getItem(CONTINUED_KEY) === CONTINUED
    ? Option.none()
    : installBrowser({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        standalone: isStandalone(),
      })

export function InstallGate({ children }: { children: React.ReactNode }) {
  const [browser, setBrowser] = React.useState(readBrowser)

  const continueInBrowser = () => {
    sessionStorage.setItem(CONTINUED_KEY, CONTINUED)
    setBrowser(Option.none())
  }

  return Option.match(browser, {
    onNone: () => children,
    onSome: (detected) => <InstallScreen browser={detected} onContinue={continueInBrowser} />,
  })
}
