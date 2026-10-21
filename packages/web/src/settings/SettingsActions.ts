import { useAtom, useAtomSet } from '@effect/atom-react/Hooks'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'

import type { NotificationEvent } from '@crook/domain/Notifications'
import { failureMessage } from '@crook/web/atoms/ActionFailure'
import {
  logOutAtom,
  sendTestNotificationAtom,
  setNotificationPrefAtom,
} from '@crook/web/atoms/Settings'
import { testNotificationState } from '@crook/web/settings/SettingsLayout'

export const useNotificationPref = (event: NotificationEvent) => {
  const [result, write] = useAtom(setNotificationPrefAtom(event), { mode: 'promiseExit' })

  return {
    pending: AsyncResult.isWaiting(result),
    failure: failureMessage(result),
    write: (enabled: boolean) => {
      void write(enabled)
    },
  }
}

export const useTestNotification = () => {
  const [result, send] = useAtom(sendTestNotificationAtom, { mode: 'promiseExit' })

  return {
    state: testNotificationState(result),
    failure: failureMessage(result),
    send: () => {
      void send()
    },
  }
}

export const useLogOut = () => {
  const [result, logOut] = useAtom(logOutAtom, { mode: 'promiseExit' })
  const control = useAtomSet(logOutAtom)
  const pending = AsyncResult.isWaiting(result)

  return {
    pending,
    failure: failureMessage(result),
    logOut: () => {
      void logOut()
    },
    forgetSettled: () => {
      if (!pending) {
        control(Atom.Reset)
      }
    },
  }
}
