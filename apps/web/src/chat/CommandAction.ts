import { useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as React from 'react'

import type { Command } from '@crook/domain/Command'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import { remembersOutcome, settledError } from '@crook/web/atoms/ActionFailure'
import type { CommandActionFailure } from '@crook/web/atoms/ActionFailure'
import { isFailed, isIdle } from '@crook/web/atoms/ActionProgress'
import type { CommandProgress } from '@crook/web/atoms/ActionProgress'
import {
  CommandRequest,
  pendingActionAtom,
  PendingActionKey,
  sendCommandAtom,
} from '@crook/web/atoms/Commands'
import type { HeldUpload } from '@crook/web/rpc/HubUploads'
import { mintIdempotencyKey } from '@crook/web/rpc/IdempotencyKeys'

export interface CommandAction {
  readonly state: CommandProgress
  readonly refusal: Option.Option<CommandActionFailure>
  readonly last: Option.Option<Command>
  readonly key: IdempotencyKey
  readonly send: (command: Command, uploads?: readonly HeldUpload[]) => IdempotencyKey
}

interface ActionKeys {
  readonly current: IdempotencyKey
  readonly spare: IdempotencyKey
}

const freshKeys = (): ActionKeys => ({
  current: mintIdempotencyKey(),
  spare: mintIdempotencyKey(),
})

const sentAgainUnderSameKey = (
  state: CommandProgress,
  refusal: Option.Option<CommandActionFailure>,
  last: Option.Option<Command>,
  command: Command,
): boolean =>
  isFailed(state) &&
  Option.exists(last, (previous) => Equal.equals(previous, command)) &&
  !Option.exists(refusal, remembersOutcome)

export const useCommandAction = (machine: MachineId): CommandAction => {
  const [keys, setKeys] = React.useState(freshKeys)
  const [last, setLast] = React.useState<Option.Option<Command>>(Option.none())
  const state = useAtomValue(
    pendingActionAtom(new PendingActionKey({ key: keys.current, machine })),
  )
  const refusal = settledError(useAtomValue(sendCommandAtom(keys.current)))
  const sendCurrent = useAtomSet(sendCommandAtom(keys.current))
  const sendSpare = useAtomSet(sendCommandAtom(keys.spare))

  const send = (command: Command, uploads: readonly HeldUpload[] = []) => {
    const request = new CommandRequest({ machine, command, uploads })
    const retry = sentAgainUnderSameKey(state, refusal, last, command)

    setLast(Option.some(command))

    if (isIdle(state) || retry) {
      sendCurrent(request)

      return keys.current
    }

    sendSpare(request)
    setKeys({ current: keys.spare, spare: mintIdempotencyKey() })

    return keys.spare
  }

  return { state, refusal, last, key: keys.current, send }
}
