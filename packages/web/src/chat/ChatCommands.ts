import { useAtom } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import * as Duration from 'effect/Duration'
import * as Equal from 'effect/Equal'
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
import type { ClaudeSessionId, MachineId, PaneId } from '@crook/domain/Ids'
import type { SkillListing } from '@crook/domain/Skill'
import {
  failureMessageOf,
  isDone,
  isFailed,
  isSending,
  isSent,
  isUnconfirmed,
  unconfirmedNoteOf,
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
import { ChatItem, isOmitted, isUserPrompt } from '@crook/web/chat/ChatItems'
import { ActivityState, activityView } from '@crook/web/chat/ActivityMachine'
import { isPresent } from '@crook/web/chat/PresenceMachine'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'
import { isCommandSend, laptopOnlyNote, noAnswerNote } from '@crook/web/chat/SlashCommands'
import { useCommandAction } from '@crook/web/chat/CommandAction'
import type { CommandAction } from '@crook/web/chat/CommandAction'
import type { AskDockProps } from '@crook/web/chat/AskDock'
import type { ComposerProps, ComposerMode } from '@crook/web/chat/Composer'
import {
  composerFailureMachine,
  draftChanged,
  PROMPT_SENT,
  promptRefused,
  STOP_PRESSED,
  stopRefused,
  TURN_ENDED,
} from '@crook/web/chat/ComposerFailureMachine'
import type {
  ComposerFailureEvent,
  ComposerFailureState,
} from '@crook/web/chat/ComposerFailureMachine'
import type { Restart } from '@crook/web/chat/EdgeCard'
import { carriedOrigin } from '@crook/web/navigation/ChatOrigin'

export type ComposerCommands = Omit<ComposerProps, 'value' | 'onValueChange' | 'skills' | 'handle'>

interface ArrivedSends {
  readonly prompts: number
  readonly commands: number
}

interface UnansweredCommand {
  readonly text: string
  readonly answersThen: number
}

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
  readonly activity: ActivityState
  readonly canAct: boolean
  readonly items: readonly ChatItem[]
  readonly session: Option.Option<ClaudeSessionId>
  readonly threadEpoch: number
  readonly skills: readonly SkillListing[]
  readonly draft: string
  readonly setDraft: (draft: string) => void
  readonly onPromptSent: () => void
}

export interface PendingPrompt {
  readonly text: string
  readonly queued: boolean
  readonly command: boolean
}

export interface PendingPromptRow extends PendingPrompt {
  readonly key: string
}

export interface PromptWait {
  readonly promptsAtSend: number
  readonly commandsAtSend: number
  readonly holesAtSend: number
  readonly pending: readonly PendingPrompt[]
}

export interface PromptSend {
  readonly replacesFailed: boolean
  readonly prompt: Option.Option<string>
  readonly working: boolean
}

const PENDING_PROMPT_KEY = 'pending prompt'
const MANUAL_COMPACT = 'manual'

const NOTHING_AWAITED: PromptWait = {
  promptsAtSend: 0,
  commandsAtSend: 0,
  holesAtSend: 0,
  pending: [],
}

export const STOP_SETTLE = Duration.millis(512)
export const COMMAND_SILENCE = Duration.seconds(6)

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

const isAcknowledged = (state: CommandProgress): boolean =>
  isSent(state) || isUnconfirmed(state) || isDone(state)

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

const holeCount = (items: readonly ChatItem[]): number =>
  pipe(items, Arr.drop(1), Arr.filter(isOmitted)).length

const answersACommand = (item: ChatItem): boolean =>
  ChatItem.$match(item, {
    Command: () => true,
    Cleared: () => true,
    Note: (note) => note.answersACommand,
    Compacted: (compacted) => Option.contains(compacted.trigger, MANUAL_COMPACT),
    UserPrompt: () => false,
    AssistantText: () => false,
    Tool: () => false,
    Subagents: () => false,
    Plan: () => false,
    Omitted: () => false,
    Unreadable: () => false,
  })

const commandAnswerCount = (items: readonly ChatItem[]): number =>
  Arr.filter(items, answersACommand).length

const arrivedSince = (wait: PromptWait, items: readonly ChatItem[]): ArrivedSends =>
  holeCount(items) > wait.holesAtSend
    ? { prompts: wait.pending.length, commands: wait.pending.length }
    : {
        prompts: Math.max(promptCount(items) - wait.promptsAtSend, 0),
        commands: Math.max(commandAnswerCount(items) - wait.commandsAtSend, 0),
      }

const withoutArrived = <Send extends PendingPrompt>(
  pending: readonly Send[],
  arrived: ArrivedSends,
): readonly Send[] =>
  pipe(
    pending,
    Arr.mapAccum(arrived, (left, send): readonly [ArrivedSends, Option.Option<Send>] => {
      const kind = send.command ? 'commands' : 'prompts'

      return left[kind] > 0
        ? [{ ...left, [kind]: left[kind] - 1 }, Option.none()]
        : [left, Option.some(send)]
    }),
    ([, kept]) => Arr.getSomes(kept),
  )

const hasArrived = (wait: PromptWait, items: readonly ChatItem[]): boolean =>
  Arr.isReadonlyArrayEmpty(withoutArrived(wait.pending, arrivedSince(wait, items)))

const awaitsAnswer = (command: Command): boolean => Option.isSome(textOf(command))

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
  const waiting = Arr.isReadonlyArrayNonEmpty(carried)
  const promptsAtSend = waiting ? wait.promptsAtSend : promptCount(items)
  const commandsAtSend = waiting ? wait.commandsAtSend : commandAnswerCount(items)
  const holesAtSend = waiting ? wait.holesAtSend : holeCount(items)
  const aheadInLine = !hasArrived(
    { promptsAtSend, commandsAtSend, holesAtSend, pending: carried },
    items,
  )
  const pending = Option.match(send.prompt, {
    onNone: () => carried,
    onSome: (text) =>
      Arr.append(carried, {
        text,
        queued: send.working || aheadInLine,
        command: isCommandSend(text),
      }),
  })

  return Arr.isReadonlyArrayNonEmpty(pending)
    ? { promptsAtSend, commandsAtSend, holesAtSend, pending }
    : NOTHING_AWAITED
}

export const waitWithoutCommands = (wait: PromptWait, items: readonly ChatItem[]): PromptWait => {
  const pending = Arr.filter(wait.pending, (send) => !send.command)

  return Arr.isReadonlyArrayNonEmpty(pending)
    ? { ...wait, commandsAtSend: commandAnswerCount(items), pending }
    : NOTHING_AWAITED
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
    (shown) => withoutArrived(shown, arrivedSince(wait, items)),
  )

const isPromptInFlight = (action: CommandAction): boolean =>
  !isAcknowledged(action.state) && Option.exists(action.last, awaitsAnswer)

const startedPane = (receipt: CommandReceipt): Option.Option<PaneId> =>
  Match.value(receipt).pipe(
    Match.tag('AgentStarted', (started) => Option.some(started.pane)),
    Match.orElse(() => Option.none<PaneId>()),
  )

const placeholderOf = (canAct: boolean, mode: ComposerMode, blocked: boolean): string => {
  if (!canAct) {
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

const lastCommandOf = (rows: readonly PendingPromptRow[]): Option.Option<string> =>
  pipe(
    rows,
    Arr.findLast((row) => row.command),
    Option.map((row) => row.text),
  )

const usePromptWait = (
  items: readonly ChatItem[],
  threadEpoch: number,
  inFlight: boolean,
  working: boolean,
) => {
  const [wait, setWait] = React.useState<PromptWait>(NOTHING_AWAITED)
  const [waitedIn, setWaitedIn] = React.useState(threadEpoch)
  const [unanswered, setUnanswered] = React.useState(Option.none<UnansweredCommand>())
  const arrived = hasArrived(wait, items)
  const rows = React.useMemo(
    () => pendingPromptRows(wait, items, inFlight),
    [wait, items, inFlight],
  )
  const awaited = lastCommandOf(rows)
  const answers = commandAnswerCount(items)
  const awaitedCommands = Arr.filter(rows, (row) => row.command).length

  if (waitedIn !== threadEpoch) {
    setWaitedIn(threadEpoch)
    setWait(NOTHING_AWAITED)
    setUnanswered(Option.none())
  }

  React.useEffect(() => {
    if (Option.isNone(awaited) || working) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setUnanswered(Option.some({ text: awaited.value, answersThen: answers }))
      setWait((current) => waitWithoutCommands(current, items))
    }, Duration.toMillis(COMMAND_SILENCE))

    return () => {
      window.clearTimeout(timer)
    }
  }, [Option.getOrUndefined(awaited), awaitedCommands, answers, working])

  React.useEffect(() => {
    if (arrived && Arr.isReadonlyArrayNonEmpty(wait.pending)) {
      setWait(NOTHING_AWAITED)
    }
  }, [arrived, wait])

  return {
    rows,
    unanswered: pipe(
      unanswered,
      Option.filter((command) => command.answersThen === answers),
      Option.map((command) => noAnswerNote(command.text)),
    ),
    afterSend: (send: PromptSend) => {
      setUnanswered(Option.none())
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

const composerFailureReducer = (state: ComposerFailureState, event: ComposerFailureEvent) =>
  composerFailureMachine.transition(state, event)[0]

const useComposerFailure = (
  prompt: CommandAction,
  stop: CommandAction,
  draft: string,
  working: boolean,
) => {
  const [state, dispatch] = React.useReducer(composerFailureReducer, composerFailureMachine.initial)
  const promptFailure = Option.getOrUndefined(failureMessageOf(prompt.state))
  const stopFailure = Option.getOrUndefined(failureMessageOf(stop.state))
  const failedText = Option.getOrElse(lastTextWhen(prompt, isFailed), () => '')
  const typed = draft.trim()

  React.useEffect(() => {
    if (promptFailure !== undefined) {
      dispatch(promptRefused(promptFailure, failedText))
    }
  }, [promptFailure, failedText, dispatch])

  React.useEffect(() => {
    if (stopFailure !== undefined) {
      dispatch(stopRefused(stopFailure))
    }
  }, [stopFailure, dispatch])

  React.useEffect(() => {
    dispatch(draftChanged(typed))
  }, [typed, dispatch])

  React.useEffect(() => {
    if (!working) {
      dispatch(TURN_ENDED)
    }
  }, [working, stopFailure, dispatch])

  return {
    failure: state,
    onPromptSent: () => {
      dispatch(PROMPT_SENT)
    },
    onStopPressed: () => {
      dispatch(STOP_PRESSED)
    },
  }
}

const useAlwaysNotes = (
  opened: OpenedAgent,
  answer: CommandAction,
  session: Option.Option<ClaudeSessionId>,
) => {
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

  return {
    notes: Arr.filter(notes, (note) => Equal.equals(note.session, session)),
    expect: setAwaited,
  }
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
  activity,
  canAct,
  items,
  session,
  threadEpoch,
  skills,
  draft,
  setDraft,
  onPromptSent,
}: ChatCommandsInput): ChatCommands => {
  const { machine, pane } = opened
  const prompt = useCommandAction(machine)
  const stop = useCommandAction(machine)
  const restart = useCommandAction(machine)
  const answer = useCommandAction(machine)
  const working = Option.isSome(activityView(activity).workingSince)
  const promptInFlight = isPromptInFlight(prompt)
  const prompted = usePromptWait(items, threadEpoch, promptInFlight, working)
  const [refused, setRefused] = React.useState('')
  const refusal = Option.filter(
    laptopOnlyNote(draft.trim(), skills),
    () => refused === draft.trim(),
  )

  if (refused !== '' && refused !== draft.trim()) {
    setRefused('')
  }

  const blocked = ActivityState.guards.Blocked(activity)
  const composerFailure = useComposerFailure(prompt, stop, draft, working)
  const stopping = useStopLock(stop)
  const always = useAlwaysNotes(opened, answer, session)
  const openAsk = Option.flatMap(
    Option.filter(model.row, () => blocked && isPresent(model.presence)),
    (row) => row.ask,
  )
  const mode: ComposerMode = Option.isSome(openAsk) ? 'decline' : 'prompt'
  const answering = Option.exists(openAsk, (ask) => isAnswerUnderway(answerState(answer, ask.id)))
  const declining = Option.exists(openAsk, (ask) => isAnswerUnderway(answerState(prompt, ask.id)))

  useClearSentDraft(prompt, draft, setDraft)
  useRestoreUndeliveredDraft(prompt, draft, setDraft)
  useRestartInPlace(machine, restart)

  const sendPrompt = (command: Command) => {
    composerFailure.onPromptSent()
    prompted.afterSend({
      replacesFailed: isFailed(prompt.state) && Option.exists(prompt.last, awaitsAnswer),
      prompt: textOf(command),
      working,
    })
    prompt.send(command)
  }

  const send = (text: string) => {
    Option.match(openAsk, {
      onNone: () => {
        if (Option.isSome(laptopOnlyNote(text, skills))) {
          setRefused(text)

          return
        }

        onPromptSent()
        sendPrompt(new Prompt({ pane, text }))
      },
      onSome: (ask) => {
        onPromptSent()
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
    always.expect(alwaysNoteFor(ask, given, items, session))
    answer.send(new AnswerAsk({ pane, ask: ask.id, answer: given }))
  }

  return {
    ask: Option.map(openAsk, (ask) => ({
      ask,
      state: answerState(answer, ask.id),
      disabled: !canAct || declining,
      onAnswer: answerAsk(ask),
      onDeclineWithMessage: send,
    })),
    alwaysNotes: always.notes,
    composer: {
      onSend: send,
      onStop: () => {
        if (!stopping) {
          composerFailure.onStopPressed()
          stop.send(interrupt(pane))
        }
      },
      mode,
      working,
      disabled: !canAct || (blocked && mode === 'prompt') || (mode === 'decline' && answering),
      sending: isSending(prompt.state),
      stopping,
      placeholder: placeholderOf(canAct, mode, blocked),
      label: mode === 'decline' ? 'Tell Claude what to do instead' : 'Message to Claude',
      failure: composerFailure.failure,
      note: Option.orElse(refusal, () => prompted.unanswered),
    },
    restart: Option.map(
      Option.flatMap(model.row, (row) => decodeFolder(row.cwd)),
      (folder) => ({
        start: () => {
          restart.send(new StartAgent({ kind: 'claude', folder, task: Option.none() }))
        },
        starting: isInFlight(restart),
        disabled: !canAct,
        failure: Option.orElse(failureMessageOf(restart.state), () =>
          unconfirmedNoteOf(restart.state),
        ),
      }),
    ),
    pendingPrompts: prompted.rows,
  }
}
