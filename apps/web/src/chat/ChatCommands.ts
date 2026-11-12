import { useAtom, useAtomSet } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import * as Duration from 'effect/Duration'
import * as Equal from 'effect/Equal'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as React from 'react'

import type { AgentRow } from '@crook/domain/AgentRow'
import type { Ask } from '@crook/domain/Ask'
import {
  AnswerAsk,
  attachmentsOf,
  Decline,
  FolderPath,
  interrupt,
  Prompt,
  StartAgent,
  takesAttachments,
} from '@crook/domain/Command'
import type { AskAnswer, Command, CommandReceipt } from '@crook/domain/Command'
import type { ClaudeSessionId, IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'
import type { SkillListing } from '@crook/domain/Skill'
import { CLAUDE_WAITING_NOTE } from '@crook/protocol/Commands'
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
import { clearSentDraftAtom, SentDraft } from '@crook/web/atoms/SentDrafts'
import { ComposerDraft, DraftKey } from '@crook/web/cache/DraftCache'
import type { OpenedAgent } from '@crook/web/atoms/Herd'
import {
  answerHeard,
  answerPressed,
  askAnswerMachine,
  AskAnswerEvent,
  askingOf,
  askShown,
  isAnswerUnderway,
} from '@crook/web/chat/AskAnswerMachine'
import type { AskAnswerState } from '@crook/web/chat/AskAnswerMachine'
import { alwaysNoteFor } from '@crook/web/chat/AskModel'
import type { AlwaysNote } from '@crook/web/chat/AskModel'
import { ChatItem, isOmitted, isUserPrompt } from '@crook/web/chat/ChatItems'
import { ActivityState, activityView } from '@crook/web/chat/ActivityMachine'
import { isPresent } from '@crook/web/chat/PresenceMachine'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'
import { isCommandSend, laptopOnlyNote, noAnswerNote } from '@crook/web/chat/SlashCommands'
import { useCommandAction } from '@crook/web/chat/CommandAction'
import { attachmentRefOf } from '@crook/web/chat/Attachments'
import type { DraftAttachment } from '@crook/web/chat/Attachments'
import type { HeldUpload } from '@crook/web/rpc/HubUploads'
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
import { NOTICE_DELAY } from '@crook/web/machine/NoticeTiming'
import { carriedOrigin } from '@crook/web/navigation/ChatOrigin'

export type ComposerCommands = Omit<
  ComposerProps,
  | 'value'
  | 'onValueChange'
  | 'skills'
  | 'handle'
  | 'attachments'
  | 'onAttachmentsChange'
  | 'onAttachNote'
>

export interface ComposerStatus {
  readonly failure: ComposerFailureState
  readonly note: Option.Option<string>
}

interface ArrivedSends {
  readonly prompts: number
  readonly commands: number
}

interface UnansweredCommand {
  readonly text: string
  readonly answersThen: number
}

interface AwaitedNote {
  readonly note: AlwaysNote
  readonly key: IdempotencyKey
}

export type AskDockCommands = Omit<AskDockProps, 'cwd'>

export interface ChatCommands {
  readonly composer: ComposerCommands
  readonly composerStatus: ComposerStatus
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
  readonly attachments: readonly DraftAttachment[]
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
const ATTACHED_LABEL = 'Attached'
const MANUAL_COMPACT = 'manual'

const ATTACHED_COMMAND_NOTE =
  'A command cannot carry attachments. Send the command on its own, or remove the attachments.'

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
    Command: (command) => Option.isNone(command.sender),
    Cleared: () => true,
    Note: (note) => note.answersACommand,
    Compacted: (compacted) => Option.contains(compacted.trigger, MANUAL_COMPACT),
    UserPrompt: () => false,
    ForeignPrompt: () => false,
    AssistantText: () => false,
    Tool: () => false,
    Subagents: () => false,
    Plan: () => false,
    Omitted: () => false,
    Unreadable: () => false,
    StopHookFeedback: () => false,
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

const isDeclineOut = (action: CommandAction): boolean =>
  isSending(action.state) && Option.exists(action.last, Schema.is(AnswerAsk))

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

const isClaudeWaiting = (row: Option.Option<AgentRow>): boolean =>
  Option.exists(row, (shown) => Option.contains(shown.claudeWaiting, true))

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

const shownPromptText = (command: Command, text: string): string =>
  text.length > 0
    ? text
    : `${ATTACHED_LABEL} ${attachmentsOf(command)
        .map((attachment) => attachment.name)
        .join(', ')}`

const attachRefusalOf = (model: ChatScreenModel): Option.Option<string> =>
  Option.map(
    Option.filter(model.machine, (machine) => !takesAttachments(machine.agentVersion)),
    (machine) =>
      `The crook agent on ${machine.label} is too old to take attachments. Update it from the Machines tab, then attach again.`,
  )

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
  claudeWaits: boolean,
  askOpen: boolean,
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

  const giveUpAfter = (silence: Duration.Duration) => {
    if (Option.isNone(awaited) || working) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setUnanswered(Option.some({ text: awaited.value, answersThen: answers }))
      setWait((current) => waitWithoutCommands(current, items))
    }, Duration.toMillis(silence))

    return () => {
      window.clearTimeout(timer)
    }
  }

  const awaitedText = Option.getOrUndefined(awaited)
  const holdsForClaude = claudeWaits && !askOpen

  React.useEffect(
    () => giveUpAfter(COMMAND_SILENCE),
    [awaitedText, awaitedCommands, answers, working],
  )

  React.useEffect(
    () => (holdsForClaude ? giveUpAfter(NOTICE_DELAY) : undefined),
    [awaitedText, awaitedCommands, answers, working, holdsForClaude],
  )

  React.useEffect(() => {
    if (!claudeWaits) {
      setUnanswered(Option.none())
    }
  }, [claudeWaits])

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
  const [awaited, setAwaited] = React.useState(Option.none<AwaitedNote>())
  const heard = Option.filter(answerHeard(answer), (event) =>
    Option.exists(awaited, (note) => note.key === event.key),
  )
  const answered = Option.exists(heard, AskAnswerEvent.guards.Delivered)
  const abandoned = Option.isSome(heard) && !answered
  const sessionNotes = React.useMemo(
    () => Arr.filter(notes, (note) => Equal.equals(note.session, session)),
    [notes, session],
  )

  React.useEffect(() => {
    if (answered && Option.isSome(awaited)) {
      const { note } = awaited.value

      setNotes((current) =>
        Arr.some(current, (kept) => kept.ask === note.ask) ? current : [...current, note],
      )
      setAwaited(Option.none())
    } else if (abandoned) {
      setAwaited(Option.none())
    }
  }, [answered, abandoned])

  return {
    notes: sessionNotes,
    expect: (note: Option.Option<AlwaysNote>, key: IdempotencyKey) => {
      setAwaited(Option.map(note, (expected) => ({ note: expected, key })))
    },
  }
}

const askAnswerStep = (state: AskAnswerState, event: AskAnswerEvent): AskAnswerState =>
  askAnswerMachine.transition(state, event)[0]

const useAskAnswer = (asking: Option.Option<string>, answer: CommandAction) => {
  const [held, setHeld] = React.useState<AskAnswerState>(askAnswerMachine.initial)
  const state = pipe(
    [Option.map(asking, askShown), answerHeard(answer)],
    Arr.getSomes,
    Arr.reduce(held, askAnswerStep),
  )

  if (state !== held) {
    setHeld(state)
  }

  return {
    state,
    dispatch: (event: AskAnswerEvent) => {
      setHeld((current) => askAnswerStep(current, event))
    },
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
  attachments,
  onPromptSent,
}: ChatCommandsInput): ChatCommands => {
  const { machine, pane } = opened
  const prompt = useCommandAction(machine)
  const stop = useCommandAction(machine)
  const restart = useCommandAction(machine)
  const clearSentDraft = useAtomSet(clearSentDraftAtom)
  const answer = useCommandAction(machine)
  const working = Option.isSome(activityView(activity).workingSince)
  const promptInFlight = isPromptInFlight(prompt)
  const blocked = ActivityState.guards.Blocked(activity)
  const openAsking = Option.flatMap(
    Option.filter(model.row, () => blocked && isPresent(model.presence)),
    (row) => Option.map(row.ask, (ask) => ({ ask, asking: askingOf(row, ask) })),
  )
  const openAsk = Option.map(openAsking, ({ ask }) => ask)
  const askAnswer = useAskAnswer(
    Option.map(openAsking, ({ asking }) => asking),
    answer,
  )
  const prompted = usePromptWait(
    items,
    threadEpoch,
    promptInFlight,
    working,
    isClaudeWaiting(model.row),
    Option.isSome(openAsk),
  )
  const [refused, setRefused] = React.useState('')
  const refusalOf = (text: string) =>
    pipe(
      Option.liftPredicate(
        ATTACHED_COMMAND_NOTE,
        () => attachments.length > 0 && isCommandSend(text),
      ),
      Option.orElse(() => laptopOnlyNote(text, skills)),
      Option.orElse(() =>
        Option.liftPredicate(CLAUDE_WAITING_NOTE, () => isClaudeWaiting(model.row)),
      ),
    )
  const refusal = Option.filter(
    refusalOf(draft.trim()),
    () => refused !== '' && refused === draft.trim() && Option.isNone(openAsk),
  )

  if (refused !== '' && refused !== draft.trim()) {
    setRefused('')
  }

  const composerFailure = useComposerFailure(prompt, stop, draft, working)
  const stopping = useStopLock(stop)
  const always = useAlwaysNotes(opened, answer, session)
  const mode: ComposerMode = Option.isSome(openAsk) ? 'decline' : 'prompt'
  const answering = Option.isSome(openAsk) && isAnswerUnderway(askAnswer.state)

  useRestoreUndeliveredDraft(prompt, draft, setDraft)
  useRestartInPlace(machine, restart)

  const sendPrompt = (command: Command, uploads: readonly HeldUpload[] = []) => {
    composerFailure.onPromptSent()
    prompted.afterSend({
      replacesFailed: isFailed(prompt.state) && Option.exists(prompt.last, awaitsAnswer),
      prompt: Option.map(textOf(command), (text) => shownPromptText(command, text)),
      working,
    })
    clearSentDraft(
      new SentDraft({
        key: prompt.send(command, uploads),
        draft: new DraftKey({ machine, pane }),
        text: textOf(command),
        digests: Arr.map(attachmentsOf(command), (attachment) => attachment.digest),
        atSend: new ComposerDraft({ text: draft, attachments }),
      }),
    )
  }

  const send = (text: string) => {
    Option.match(openAsking, {
      onNone: () => {
        if (Option.isSome(refusalOf(text))) {
          composerFailure.onPromptSent()
          setRefused(text)

          return
        }

        onPromptSent()
        sendPrompt(
          new Prompt({ pane, text, attachments: attachments.map(attachmentRefOf) }),
          attachments.map(({ digest, bytes }) => ({ digest, bytes })),
        )
      },
      onSome: ({ ask }) => {
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

  const answerAsk = (ask: Ask, asking: string) => (given: AskAnswer) => {
    const key = answer.send(new AnswerAsk({ pane, ask: ask.id, answer: given }))

    always.expect(alwaysNoteFor(ask, given, items, session), key)
    askAnswer.dispatch(answerPressed(asking, key, given))
  }

  return {
    ask: Option.map(openAsking, ({ ask, asking }) => ({
      ask,
      state: askAnswer.state,
      disabled: !canAct || isDeclineOut(prompt),
      onAnswer: answerAsk(ask, asking),
      onDeclineWithMessage: send,
    })),
    alwaysNotes: always.notes,
    composer: {
      onSend: send,
      attachRefusal: attachRefusalOf(model),
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
    },
    composerStatus: {
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
