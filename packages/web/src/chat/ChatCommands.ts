import { useAtom } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import * as Duration from 'effect/Duration'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as React from 'react'

import type { Ask } from '@crook/domain/Ask'
import {
  AnswerAsk,
  Decline,
  FolderPath,
  interrupt,
  Prompt,
  StartAgent,
} from '@crook/domain/Command'
import type { AskAnswer, Command, CommandReceipt } from '@crook/domain/Command'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import {
  failureMessageOf,
  isDone,
  isFailed,
  isSending,
  isSent,
} from '@crook/web/atoms/ActionProgress'
import type { CommandProgress } from '@crook/web/atoms/ActionProgress'
import { alwaysNotesAtom } from '@crook/web/atoms/Chat'
import type { OpenedAgent } from '@crook/web/atoms/Herd'
import {
  alwaysNoteFor,
  answerState,
  isAnswered,
  isAnswerSettled,
  isAnswerUnderway,
} from '@crook/web/chat/AskModel'
import type { AlwaysNote } from '@crook/web/chat/AskModel'
import { isUserPrompt } from '@crook/web/chat/ChatItems'
import type { ChatItem } from '@crook/web/chat/ChatItems'
import { activityOf } from '@crook/web/chat/ChatModel'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'
import { useCommandAction } from '@crook/web/chat/CommandAction'
import type { CommandAction } from '@crook/web/chat/CommandAction'
import type { AskDockProps } from '@crook/web/chat/AskDock'
import type { ComposerProps, ComposerMode } from '@crook/web/chat/Composer'
import type { Restart } from '@crook/web/chat/EdgeCard'
import type { ConnectionView } from '@crook/web/connection/ConnectionView'
import { carriedOrigin } from '@crook/web/navigation/ChatOrigin'

export type ComposerCommands = Omit<ComposerProps, 'value' | 'onValueChange' | 'skills' | 'handle'>

export type AskDockCommands = Omit<AskDockProps, 'cwd'>

export interface ChatCommands {
  readonly composer: ComposerCommands
  readonly ask: Option.Option<AskDockCommands>
  readonly alwaysNotes: readonly AlwaysNote[]
  readonly restart: Option.Option<Restart>
  readonly pendingPrompts: readonly PendingPromptRow[]
}

interface ChatCommandsInput {
  readonly opened: OpenedAgent
  readonly model: ChatScreenModel
  readonly connection: ConnectionView
  readonly items: readonly ChatItem[]
  readonly draft: string
  readonly setDraft: (draft: string) => void
}

export interface PendingPrompt {
  readonly text: string
  readonly queued: boolean
}

export interface PendingPromptRow extends PendingPrompt {
  readonly key: string
}

export interface PromptWait {
  readonly promptsAtSend: number
  readonly pending: readonly PendingPrompt[]
}

export interface PromptSend {
  readonly replacesFailed: boolean
  readonly prompt: Option.Option<string>
  readonly working: boolean
}

const SLASH = '/'
const PENDING_PROMPT_KEY = 'pending prompt'
const NOTHING_AWAITED: PromptWait = { promptsAtSend: 0, pending: [] }

export const STOP_SETTLE = Duration.millis(512)

const decodeFolder = Schema.decodeUnknownOption(FolderPath)

const isInFlight = (action: CommandAction): boolean =>
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

const isAcknowledged = (state: CommandProgress): boolean => isSent(state) || isDone(state)

const lastTextWhen = (
  action: CommandAction,
  holds: (state: CommandProgress) => boolean,
): Option.Option<string> =>
  pipe(
    Option.liftPredicate(action, (candidate) => holds(candidate.state)),
    Option.flatMap((kept) => kept.last),
    Option.flatMap(textOf),
  )

const promptCount = (items: readonly ChatItem[]): number => Arr.filter(items, isUserPrompt).length

const arrivedSince = (wait: PromptWait, items: readonly ChatItem[]): number =>
  Math.max(promptCount(items) - wait.promptsAtSend, 0)

const hasArrived = (wait: PromptWait, items: readonly ChatItem[]): boolean =>
  arrivedSince(wait, items) >= wait.pending.length

const promptTextOf = (command: Command): Option.Option<string> =>
  Option.filter(textOf(command), (text) => !text.startsWith(SLASH))

const awaitsPrompt = (command: Command): boolean => Option.isSome(promptTextOf(command))

const carriedPrompts = (
  wait: PromptWait,
  items: readonly ChatItem[],
  send: PromptSend,
): readonly PendingPrompt[] => {
  if (hasArrived(wait, items)) {
    return []
  }

  return send.replacesFailed ? Arr.dropRight(wait.pending, 1) : wait.pending
}

export const waitAfterSend = (
  wait: PromptWait,
  items: readonly ChatItem[],
  send: PromptSend,
): PromptWait => {
  const carried = carriedPrompts(wait, items, send)
  const promptsAtSend = Arr.isReadonlyArrayNonEmpty(carried)
    ? wait.promptsAtSend
    : promptCount(items)
  const aheadInLine = !hasArrived({ promptsAtSend, pending: carried }, items)
  const pending = Option.match(send.prompt, {
    onNone: () => carried,
    onSome: (text) => Arr.append(carried, { text, queued: send.working || aheadInLine }),
  })

  return Arr.isReadonlyArrayNonEmpty(pending) ? { promptsAtSend, pending } : NOTHING_AWAITED
}

export const pendingPromptRows = (
  wait: PromptWait,
  items: readonly ChatItem[],
  inFlight: boolean,
): readonly PendingPromptRow[] =>
  pipe(
    Arr.map(wait.pending, (pending, index) => ({
      ...pending,
      key: `${PENDING_PROMPT_KEY} ${wait.promptsAtSend + index}`,
    })),
    Arr.dropRight(inFlight ? 1 : 0),
    Arr.drop(arrivedSince(wait, items)),
  )

const isPromptInFlight = (action: CommandAction): boolean =>
  !isAcknowledged(action.state) && Option.exists(action.last, awaitsPrompt)

const startedPane = (receipt: CommandReceipt): Option.Option<PaneId> =>
  Match.value(receipt).pipe(
    Match.tag('AgentStarted', (started) => Option.some(started.pane)),
    Match.orElse(() => Option.none<PaneId>()),
  )

const placeholderOf = (
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

const useRestoreUndeliveredDraft = (
  action: CommandAction,
  draft: string,
  setDraft: (draft: string) => void,
) => {
  const undelivered = Option.getOrElse(lastTextWhen(action, isFailed), () => '')

  React.useEffect(() => {
    if (undelivered !== '' && draft.trim() === '') {
      setDraft(undelivered)
    }
  }, [undelivered])
}

const useClearSentDraft = (
  action: CommandAction,
  draft: string,
  setDraft: (draft: string) => void,
) => {
  const sent = Option.getOrElse(lastTextWhen(action, isAcknowledged), () => '')

  React.useEffect(() => {
    if (sent !== '' && draft.trim() === sent) {
      setDraft('')
    }
  }, [sent])
}

const usePromptWait = (items: readonly ChatItem[]) => {
  const [wait, setWait] = React.useState<PromptWait>(NOTHING_AWAITED)
  const arrived = hasArrived(wait, items)

  React.useEffect(() => {
    if (arrived && Arr.isReadonlyArrayNonEmpty(wait.pending)) {
      setWait(NOTHING_AWAITED)
    }
  }, [arrived, wait])

  return {
    wait,
    afterSend: (send: PromptSend) => {
      setWait(waitAfterSend(wait, items, send))
    },
  }
}

const useStopLock = (stop: CommandAction): boolean => {
  const acknowledged = isSent(stop.state)
  const [settled, setSettled] = React.useState(false)

  React.useEffect(() => {
    setSettled(false)

    if (!acknowledged) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setSettled(true)
    }, Duration.toMillis(STOP_SETTLE))

    return () => {
      window.clearTimeout(timer)
    }
  }, [acknowledged])

  return isSending(stop.state) || (acknowledged && !settled)
}

const useAlwaysNotes = (opened: OpenedAgent, answer: CommandAction) => {
  const [notes, setNotes] = useAtom(alwaysNotesAtom(opened))
  const [awaited, setAwaited] = React.useState(Option.none<AlwaysNote>())
  const answered = Option.filter(awaited, (note) => isAnswered(answerState(answer, note.ask)))
  const abandoned = Option.exists(awaited, (note) => isAnswerSettled(answerState(answer, note.ask)))

  React.useEffect(() => {
    if (Option.isSome(answered)) {
      const note = answered.value

      setNotes((current) =>
        Arr.some(current, (kept) => kept.ask === note.ask) ? current : [...current, note],
      )
      setAwaited(Option.none())
    } else if (abandoned) {
      setAwaited(Option.none())
    }
  }, [Option.isSome(answered), abandoned])

  return { notes, expect: setAwaited }
}

const useRestartInPlace = (machine: MachineId, action: CommandAction) => {
  const navigate = useNavigate()
  const target = pipe(
    Option.liftPredicate(action.state, (state) => isDone(state)),
    Option.flatMap((done) => startedPane(done.receipt)),
    Option.getOrUndefined,
  )

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
  opened,
  model,
  connection,
  items,
  draft,
  setDraft,
}: ChatCommandsInput): ChatCommands => {
  const { machine, pane } = opened
  const prompt = useCommandAction(machine)
  const stop = useCommandAction(machine)
  const restart = useCommandAction(machine)
  const answer = useCommandAction(machine)
  const prompted = usePromptWait(items)
  const activity = activityOf(model)
  const blocked = activity === 'blocked'
  const stopping = useStopLock(stop)
  const always = useAlwaysNotes(opened, answer)
  const openAsk = Option.flatMap(
    Option.filter(model.row, () => blocked && model.presence === 'live'),
    (row) => row.ask,
  )
  const mode: ComposerMode = Option.isSome(openAsk) ? 'decline' : 'prompt'
  const answering = Option.exists(openAsk, (ask) => isAnswerUnderway(answerState(answer, ask.id)))
  const declining = Option.exists(openAsk, (ask) => isAnswerUnderway(answerState(prompt, ask.id)))

  useClearSentDraft(prompt, draft, setDraft)
  useRestoreUndeliveredDraft(prompt, draft, setDraft)
  useRestartInPlace(machine, restart)

  const sendPrompt = (command: Command) => {
    prompted.afterSend({
      replacesFailed: isFailed(prompt.state) && Option.exists(prompt.last, awaitsPrompt),
      prompt: promptTextOf(command),
      working: activity === 'working',
    })
    prompt.send(command)
  }

  const send = (text: string) => {
    Option.match(openAsk, {
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
    })
  }

  const answerAsk = (ask: Ask) => (given: AskAnswer) => {
    always.expect(alwaysNoteFor(ask, given, items))
    answer.send(new AnswerAsk({ pane, ask: ask.id, answer: given }))
  }

  return {
    ask: Option.map(openAsk, (ask) => ({
      ask,
      state: answerState(answer, ask.id),
      disabled: !connection.canAct || declining,
      onAnswer: answerAsk(ask),
      onDeclineWithMessage: send,
    })),
    alwaysNotes: always.notes,
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
        !connection.canAct ||
        (blocked && mode === 'prompt') ||
        (mode === 'decline' && answering) ||
        model.presence === 'loading',
      sending: isSending(prompt.state),
      stopping,
      placeholder: placeholderOf(connection, mode, blocked),
      label: mode === 'decline' ? 'Tell Claude what to do instead' : 'Message to Claude',
      failure: Option.orElse(failureMessageOf(prompt.state), () => failureMessageOf(stop.state)),
    },
    restart: Option.map(
      Option.flatMap(model.row, (row) => decodeFolder(row.cwd)),
      (folder) => ({
        start: () => {
          restart.send(new StartAgent({ kind: 'claude', folder, task: Option.none() }))
        },
        starting: isInFlight(restart),
        disabled: !connection.canAct,
        failure: failureMessageOf(restart.state),
      }),
    ),
    pendingPrompts: pendingPromptRows(prompted.wait, items, isPromptInFlight(prompt)),
  }
}
