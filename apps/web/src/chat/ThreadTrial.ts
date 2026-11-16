import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as React from 'react'

const NATIVE_THREAD_KEY = 'crook.trial.native-thread'
const NATIVE_THREAD_ON = 'on'

export class TrialSettingUnreadable extends Schema.TaggedError<TrialSettingUnreadable>()(
  'TrialSettingUnreadable',
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return 'The browser refused its local storage, so the chat scrolling trial stays off. Allow site data for crook to turn it on.'
  }
}

const listeners = new Set<() => void>()

const readsNative = (): boolean =>
  Effect.runSync(
    Effect.try({
      try: () => window.localStorage.getItem(NATIVE_THREAD_KEY) === NATIVE_THREAD_ON,
      catch: (cause) => new TrialSettingUnreadable({ cause }),
    }).pipe(Effect.catchTag('TrialSettingUnreadable', () => Effect.succeed(false))),
  )

const subscribe = (listener: () => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export const setNativeThread = (on: boolean): void => {
  Effect.runSync(
    Effect.try({
      try: () => {
        if (on) {
          window.localStorage.setItem(NATIVE_THREAD_KEY, NATIVE_THREAD_ON)
        } else {
          window.localStorage.removeItem(NATIVE_THREAD_KEY)
        }
      },
      catch: (cause) => new TrialSettingUnreadable({ cause }),
    }).pipe(Effect.catchTag('TrialSettingUnreadable', (error) => Effect.logWarning(error.message))),
  )
  listeners.forEach((listener) => {
    listener()
  })
}

export const useNativeThread = (): boolean =>
  React.useSyncExternalStore(subscribe, readsNative, () => false)
