import { useNavigate } from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as React from 'react'

import type { AgentRow } from '@crook/domain/AgentRow'
import {
  AnswerAsk,
  Decline,
  FolderPath,
  interrupt,
  Prompt,
  StartAgent,
} from '@crook/domain/Command'
import type { Command, CommandReceipt } from '@crook/domain/Command'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { PendingAction } from '@crook/web/atoms/Commands'
import { ChatItem } from '@crook/web/chat/ChatItems'
import { activityOf } from '@crook/web/chat/ChatModel'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'
import { useCommandAction } from '@crook/web/chat/CommandAction'
import type { CommandAction } from '@crook/web/chat/CommandAction'
import type { ComposerProps, ComposerMode } from '@crook/web/chat/Composer'
import type { Restart } from '@crook/web/chat/EdgeCard'
import type { ConnectionView } from '@crook/web/connection/ConnectionView'
import { carriedOrigin } from '@crook/web/navigation/ChatOrigin'

export type ComposerCommands = Omit<ComposerProps, 'value' | 'onValueChange'>

export interface ChatCommands {
  readonly composer: ComposerCommands
  readonly blocked: boolean
  readonly restart: Option.Option<Restart>
  readonly pendingPrompt: Option.Option<string>
}

export interface ChatCommandsInput {
  readonly machine: MachineId
  readonly pane: PaneId
  readonly model: ChatScreenModel
  readonly connection: ConnectionView
  readonly items: readonly ChatItem[]
  readonly draft: string
  readonly setDraft: (draft: string) => void
}

const SLASH = '/'

const isSending = PendingAction.$is('Sending')
const isSent = PendingAction.$is('Sent')
const isDone = PendingAction.$is('Done')
const isUserPrompt = ChatItem.$is('UserPrompt')

const decodeFolder = Schema.decodeUnknownOption(FolderPath)

export const failureOf = (action: CommandAction): Option.Option<string> =>
  PendingAction.$match(action.state, {
    Failed: (failed) => Option.some(failed.message),
    Idle: () => Option.none(),
    Sending: () => Option.none(),
    Sent: () => Option.none(),
    Done: () => Option.none(),
  })

export const isInFlight = (action: CommandAction): boolean =>
  isSending(action.state) || isSent(action.state)

const textOf = (command: Command): Option.Option<string> =>
  Match.value(command).pipe(
    Match.tags({
      Prompt: (prompt) => Option.some(prompt.text),
      AnswerAsk: (answer) =>
        Match.value(answer.answer).pipe(
          Match.tag('Decline', (decline) => decline.message),
          Match.orElse(() => Option.none<string>()),
        ),
    }),
    Match.orElse(() => Option.none<string>()),
  )

const isAcknowledged = (action: CommandAction): boolean =>
  isSent(action.state) || isDone(action.state)

export const sentText = (action: CommandAction): Option.Option<string> =>
  pipe(
    Option.liftPredicate(action, isAcknowledged),
    Option.flatMap((acknowledged) => acknowledged.last),
    Option.flatMap(textOf),
  )

export const promptCount = (items: readonly ChatItem[]): number =>
  Arr.filter(items, isUserPrompt).length

export const pendingPromptText = (
  action: CommandAction,
  promptsAtSend: number,
  items: readonly ChatItem[],
): Option.Option<string> =>
  pipe(
    sentText(action),
    Option.filter((text) => !text.startsWith(SLASH)),
    Option.filter(() => promptCount(items) <= promptsAtSend),
  )

const startedPane = (receipt: CommandReceipt): Option.Option<PaneId> =>
  Match.value(receipt).pipe(
    Match.tag('AgentStarted', (started) => Option.some(started.pane)),
    Match.orElse(() => Option.none<PaneId>()),
  )

export const composerMode = (row: Option.Option<AgentRow>, blocked: boolean): ComposerMode =>
  blocked && Option.exists(row, (found) => Option.isSome(found.ask)) ? 'decline' : 'prompt'

export const placeholderOf = (
  connection: ConnectionView,
  mode: ComposerMode,
  blocked: boolean,
): string => {
  if (!connection.canAct) {
    return 'Sending is paused until crook reconnects'
  }

  if (mode === 'decline') {
    return 'Or tell Claude what to do instead'
  }

  return blocked ? "Waiting for Claude's question" : 'Message Claude'
}

const useClearSentDraft = (
  action: CommandAction,
  draft: string,
  setDraft: (draft: string) => void,
) => {
  const sent = Option.getOrElse(sentText(action), () => '')

  React.useEffect(() => {
    if (sent !== '' && draft.trim() === sent) {
      setDraft('')
    }
  }, [sent])
}

const useRestartInPlace = (machine: MachineId, action: CommandAction) => {
  const navigate = useNavigate()
  const started = PendingAction.$match(action.state, {
    Done: (done) => startedPane(done.receipt),
    Idle: () => Option.none<PaneId>(),
    Sending: () => Option.none<PaneId>(),
    Sent: () => Option.none<PaneId>(),
    Failed: () => Option.none<PaneId>(),
  })
  const target = Option.getOrUndefined(started)

  React.useEffect(() => {
    if (target !== undefined) {
      void navigate({
        to: '/m/$machine/p/$pane',
        params: { machine, pane: target },
        replace: true,
        state: carriedOrigin,
      })
    }
  }, [target, machine, navigate])
}

export const useChatCommands = ({
  machine,
  pane,
  model,
  connection,
  items,
  draft,
  setDraft,
}: ChatCommandsInput): ChatCommands => {
  const prompt = useCommandAction(machine)
  const stop = useCommandAction(machine)
  const restart = useCommandAction(machine)
  const [promptsAtSend, setPromptsAtSend] = React.useState(0)
  const activity = activityOf(model)
  const blocked = activity === 'blocked'
  const mode = composerMode(model.row, blocked)
  const stopping = isInFlight(stop)

  useClearSentDraft(prompt, draft, setDraft)
  useRestartInPlace(machine, restart)

  const sendPrompt = (command: Command) => {
    setPromptsAtSend(promptCount(items))
    prompt.send(command)
  }

  const send = (text: string) => {
    Option.match(
      Option.flatMap(
        Option.filter(model.row, () => mode === 'decline'),
        (row) => row.ask,
      ),
      {
        onNone: () => {
          sendPrompt(new Prompt({ pane, text }))
        },
        onSome: (ask) => {
          sendPrompt(
            new AnswerAsk({
              pane,
              ask: ask.id,
              answer: new Decline({ message: Option.some(text) }),
            }),
          )
        },
      },
    )
  }

  return {
    blocked,
    composer: {
      onSend: send,
      onStop: () => {
        if (!stopping) {
          stop.send(interrupt(pane))
        }
      },
      mode,
      working: activity === 'working',
      disabled:
        !connection.canAct || (blocked && mode === 'prompt') || model.presence === 'loading',
      sending: isSending(prompt.state),
      stopping,
      placeholder: placeholderOf(connection, mode, blocked),
      label: mode === 'decline' ? 'Tell Claude what to do instead' : 'Message to Claude',
      failure: Option.orElse(failureOf(prompt), () => failureOf(stop)),
    },
    restart: Option.map(
      Option.flatMap(model.row, (row) => decodeFolder(row.cwd)),
      (folder) => ({
        start: () => {
          restart.send(new StartAgent({ kind: 'claude', folder, task: Option.none() }))
        },
        starting: isInFlight(restart),
        disabled: !connection.canAct,
        failure: failureOf(restart),
      }),
    ),
    pendingPrompt: pendingPromptText(prompt, promptsAtSend, items),
  }
}
