import { useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as React from 'react'

import type { Command } from '@crook/domain/Command'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import { settledError } from '@crook/web/atoms/ActionFailure'
import type { SendCommandFailure } from '@crook/web/atoms/ActionFailure'
import { ActionProgress } from '@crook/web/atoms/ActionProgress'
import type { CommandProgress } from '@crook/web/atoms/ActionProgress'
import {
  CommandRequest,
  pendingActionAtom,
  PendingActionKey,
  sendCommandAtom,
} from '@crook/web/atoms/Commands'
import { mintIdempotencyKey } from '@crook/web/rpc/IdempotencyKeys'

export interface CommandAction {
  readonly state: CommandProgress
  readonly refusal: Option.Option<SendCommandFailure>
  readonly last: Option.Option<Command>
  readonly send: (command: Command) => void
}

interface ActionKeys {
  readonly current: IdempotencyKey
  readonly spare: IdempotencyKey
}

const freshKeys = (): ActionKeys => ({
  current: mintIdempotencyKey(),
  spare: mintIdempotencyKey(),
})

const isIdle = ActionProgress.$is('Idle')
const isFailed = ActionProgress.$is('Failed')

export const useCommandAction = (machine: MachineId): CommandAction => {
  const [keys, setKeys] = React.useState(freshKeys)
  const [last, setLast] = React.useState<Option.Option<Command>>(Option.none())
  const state = useAtomValue(
    pendingActionAtom(new PendingActionKey({ key: keys.current, machine })),
  )
  const refusal = settledError(useAtomValue(sendCommandAtom(keys.current)))
  const sendCurrent = useAtomSet(sendCommandAtom(keys.current))
  const sendSpare = useAtomSet(sendCommandAtom(keys.spare))

  const send = (command: Command) => {
    const request = new CommandRequest({ machine, command })
    const retry =
      isFailed(state) && Option.exists(last, (previous) => Equal.equals(previous, command))

    setLast(Option.some(command))

    if (isIdle(state) || retry) {
      sendCurrent(request)

      return
    }

    sendSpare(request)
    setKeys({ current: keys.spare, spare: mintIdempotencyKey() })
  }

  return { state, refusal, last, send }
}
