import { useAtomValue } from '@effect/atom-react/Hooks'
import * as Cause from 'effect/Cause'
import * as Option from 'effect/Option'

import { connectionAtom, linkFailureAtom } from '@crook/web/atoms/Connection'
import { needsYouAtom } from '@crook/web/atoms/Herd'
import { ConnectionLiveRegion } from '@crook/web/connection/ConnectionBanner'
import { ConnectionContext } from '@crook/web/connection/ConnectionContext'
import { LoggedOutScreen } from '@crook/web/connection/LoggedOutScreen'
import { logInAgain } from '@crook/web/connection/Login'
import { Shell } from '@crook/web/navigation/Shell'

export function HubGate() {
  const failure = useAtomValue(linkFailureAtom)
  const connection = useAtomValue(connectionAtom)
  const needsYou = useAtomValue(needsYouAtom)

  if (Option.isSome(failure)) {
    throw Cause.squash(failure.value)
  }

  if (connection.expired) {
    return <LoggedOutScreen reason="expired" onLogIn={logInAgain} />
  }

  return (
    <ConnectionContext value={connection}>
      <ConnectionLiveRegion notice={connection.notice} />
      <Shell needsYou={needsYou} />
    </ConnectionContext>
  )
}
