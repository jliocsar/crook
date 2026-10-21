import { useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import * as Option from 'effect/Option'
import * as React from 'react'

import type { Command } from '@crook/domain/Command'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import {
  CommandRequest,
  PendingAction,
  pendingActionAtom,
  PendingActionKey,
  sendCommandAtom,
} from '@crook/web/atoms/Commands'
import { mintIdempotencyKey } from '@crook/web/rpc/IdempotencyKeys'

export interface SentAction {
  readonly fingerprint: string
  readonly command: Command
}

export interface CommandAction {
  readonly state: PendingAction
  readonly last: Option.Option<SentAction>
  readonly send: (command: Command, fingerprint: string) => void
}

interface ActionKeys {
  readonly current: IdempotencyKey
  readonly spare: IdempotencyKey
}

const freshKeys = (): ActionKeys => ({
  current: mintIdempotencyKey(),
  spare: mintIdempotencyKey(),
})

const isIdle = PendingAction.$is('Idle')
const isFailed = PendingAction.$is('Failed')

export const useCommandAction = (machine: MachineId): CommandAction => {
  const [keys, setKeys] = React.useState(freshKeys)
  const [last, setLast] = React.useState<Option.Option<SentAction>>(Option.none())
  const state = useAtomValue(
    pendingActionAtom(new PendingActionKey({ key: keys.current, machine })),
  )
  const sendCurrent = useAtomSet(sendCommandAtom(keys.current))
  const sendSpare = useAtomSet(sendCommandAtom(keys.spare))

  const send = (command: Command, fingerprint: string) => {
    const request = new CommandRequest({ machine, command })
    const retry =
      isFailed(state) && Option.exists(last, (previous) => previous.fingerprint === fingerprint)

    setLast(Option.some({ fingerprint, command }))

    if (isIdle(state) || retry) {
      sendCurrent(request)

      return
    }

    sendSpare(request)
    setKeys({ current: keys.spare, spare: mintIdempotencyKey() })
  }

  return { state, last, send }
}
