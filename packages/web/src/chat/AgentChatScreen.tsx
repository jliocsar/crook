import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Schema from 'effect/Schema'
import * as React from 'react'

import { agentTitleOrPane, pendingAskSummary } from '@crook/domain/AgentRow'
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
import { chatScreenAtom } from '@crook/web/atoms/Chat'
import { PendingAction } from '@crook/web/atoms/Commands'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { OpenedAgent, seenWhileOpenAtom } from '@crook/web/atoms/Herd'
import {
  paneTranscriptAtom,
  PaneTranscriptKey,
  paneTranscriptWholeAtom,
} from '@crook/web/atoms/Transcript'
import { ChatStatusLine, RunningPill } from '@crook/web/chat/ChatHeader'
import {
  ChatItem as ChatItems,
  chatItems,
  hasToolRunning,
  isRunning,
  runningCount,
} from '@crook/web/chat/ChatItems'
import type { ChatItem, SubagentRun } from '@crook/web/chat/ChatItems'
import { activityOf, chatStatus, machineLabelOf, workspaceLabelOf } from '@crook/web/chat/ChatModel'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'
import { useOpenedFromMachine } from '@crook/web/chat/ChatOrigin'
import {
  failureRows,
  itemRows,
  LoadingThread,
  QuietThread,
  WithHighlighter,
  workingRow,
} from '@crook/web/chat/ChatRows'
import { useCommandAction } from '@crook/web/chat/CommandAction'
import type { CommandAction } from '@crook/web/chat/CommandAction'
import { Composer } from '@crook/web/chat/Composer'
import type { ComposerMode } from '@crook/web/chat/Composer'
import { EdgeCard } from '@crook/web/chat/EdgeCard'
import type { EdgeKind, Restart } from '@crook/web/chat/EdgeCard'
import { useKeyboardInset } from '@crook/web/chat/KeyboardInset'
import { Thread } from '@crook/web/chat/Thread'
import type { ThreadHandle, ThreadRow } from '@crook/web/chat/Thread'
import type { ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import type { TranscriptView } from '@crook/web/chat/TranscriptState'
import { EmptyState } from '@crook/web/components/ui/empty-state'
import { Message } from '@crook/web/components/ui/message'
import type { ConnectionView } from '@crook/web/connection/ConnectionView'
import { PushedHeader, PushedScreen, usePushedScreen } from '@crook/web/navigation/PushedScreen'
import { shortElapsed } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

interface ChatActions {
  readonly prompt: CommandAction
  readonly stop: CommandAction
  readonly restart: CommandAction
}

interface DockProps {
  readonly pane: PaneId
  readonly model: ChatScreenModel
  readonly connection: ConnectionView
  readonly actions: ChatActions
  readonly draft: string
  readonly onDraftChange: (draft: string) => void
  readonly now: DateTime.Utc
  readonly backLabel: string
}

const BACK_TO_AGENTS = 'Back to Agents'
const NOT_CLAUDE = 'Not a Claude pane'
const NO_MESSAGES = 'No messages yet'
const PENDING_PROMPT_KEY = 'pending prompt'
const STOP_FINGERPRINT = 'stop'

const isSending = PendingAction.$is('Sending')
const isSent = PendingAction.$is('Sent')
const isDone = PendingAction.$is('Done')
const isUserPrompt = ChatItems.$is('UserPrompt')
const isSubagents = ChatItems.$is('Subagents')

const decodeFolder = Schema.decodeUnknownOption(FolderPath)

const failureOf = (action: CommandAction): Option.Option<string> =>
  PendingAction.$match(action.state, {
    Failed: (failed) => Option.some(failed.message),
    Idle: () => Option.none(),
    Sending: () => Option.none(),
    Sent: () => Option.none(),
    Done: () => Option.none(),
  })

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

const sentText = (action: CommandAction): Option.Option<string> =>
  pipe(
    Option.liftPredicate(action, isAcknowledged),
    Option.flatMap((acknowledged) => acknowledged.last),
    Option.flatMap((last) => textOf(last.command)),
  )

const lastPromptText = (items: readonly ChatItem[]): Option.Option<string> =>
  pipe(
    Arr.findLast(items, isUserPrompt),
    Option.map((item) => item.text.trim()),
  )

const pendingPromptRows = (
  action: CommandAction,
  items: readonly ChatItem[],
): readonly ThreadRow[] =>
  pipe(
    sentText(action),
    Option.filter((text) => !Option.contains(lastPromptText(items), text)),
    Option.map((text) => ({
      key: PENDING_PROMPT_KEY,
      content: (
        <Message role="user" meta="Sent">
          {text}
        </Message>
      ),
    })),
    Option.toArray,
  )

const firstRunningTree = (items: readonly ChatItem[]): Option.Option<string> =>
  pipe(
    Arr.findFirst(items, (item) => isSubagents(item) && item.runs.some(isRunning)),
    Option.map((item) => item.key),
  )

const startedPane = (receipt: CommandReceipt): Option.Option<PaneId> =>
  Match.value(receipt).pipe(
    Match.tag('AgentStarted', (started) => Option.some(started.pane)),
    Match.orElse(() => Option.none<PaneId>()),
  )

const composerMode = (row: Option.Option<AgentRow>, blocked: boolean): ComposerMode =>
  blocked && Option.exists(row, (found) => Option.isSome(found.ask)) ? 'decline' : 'prompt'

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

const edgeKindOf = (model: ChatScreenModel): Option.Option<EdgeKind> =>
  model.presence === 'away' || model.presence === 'closed' || model.presence === 'exited'
    ? Option.some(model.presence)
    : Option.none()

const placeOf = (model: ChatScreenModel): Option.Option<string> =>
  pipe(
    [Option.some(machineLabelOf(model)), workspaceLabelOf(model)],
    Arr.getSomes,
    Arr.join(' · '),
    Option.liftPredicate((text) => text !== ''),
    Option.filter(() => Option.isSome(model.machine)),
  )

const emptyThread = (model: ChatScreenModel, view: Option.Option<TranscriptView>) => {
  if (model.presence === 'notClaude') {
    return <EmptyState title={NOT_CLAUDE} />
  }

  return Option.isNone(view) ? <LoadingThread /> : <QuietThread>{NO_MESSAGES}</QuietThread>
}

const useTranscript = (key: PaneTranscriptKey): Option.Option<TranscriptView> =>
  AsyncResult.value(useAtomValue(paneTranscriptAtom(key)))

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
      })
    }
  }, [target, machine, navigate])
}

function AskSlot({ row }: { row: AgentRow }) {
  return Option.match(pendingAskSummary(row), {
    onNone: () => null,
    onSome: (summary) => (
      <section
        data-slot="ask-dock"
        aria-label="Needs you"
        className="border-border bg-muted/40 grid gap-0.5 rounded-[var(--radius)] border px-3.5 py-2.5"
      >
        <p className="text-muted-foreground text-xs font-semibold">Needs you</p>
        <p className="truncate font-mono text-sm">{summary}</p>
      </section>
    ),
  })
}

function ChatDock({
  pane,
  model,
  connection,
  actions,
  draft,
  onDraftChange,
  now,
  backLabel,
}: DockProps) {
  const { back } = usePushedScreen()
  const inset = useKeyboardInset()
  const activity = activityOf(model)
  const blocked = activity === 'blocked'
  const mode = composerMode(model.row, blocked)
  const askless = blocked && mode === 'prompt'
  const folder = Option.flatMap(model.row, (row) => decodeFolder(row.cwd))
  const [composerFocused, setComposerFocused] = React.useState(false)

  const send = (text: string) => {
    Option.match(
      Option.flatMap(
        Option.filter(model.row, () => mode === 'decline'),
        (row) => row.ask,
      ),
      {
        onNone: () => {
          actions.prompt.send(new Prompt({ pane, text }), `prompt ${text}`)
        },
        onSome: (ask) => {
          actions.prompt.send(
            new AnswerAsk({
              pane,
              ask: ask.id,
              answer: new Decline({ message: Option.some(text) }),
            }),
            `decline ${ask.id} ${text}`,
          )
        },
      },
    )
  }

  const restart: Option.Option<Restart> = Option.map(folder, (path) => ({
    start: () => {
      actions.restart.send(
        new StartAgent({ kind: 'claude', folder: path, task: Option.none() }),
        `restart ${path}`,
      )
    },
    starting: isSending(actions.restart.state) || isSent(actions.restart.state),
    disabled: !connection.canAct,
    failure: failureOf(actions.restart),
  }))

  if (model.presence === 'notClaude') {
    return null
  }

  return (
    <div
      data-slot="chat-dock"
      className="border-border bg-card border-t px-3 pt-3 pb-[max(var(--safe-bottom),0.75rem)]"
      style={inset > 0 ? { paddingBottom: inset } : undefined}
    >
      {Option.match(edgeKindOf(model), {
        onSome: (kind) => (
          <EdgeCard
            kind={kind}
            machineLabel={machineLabelOf(model)}
            since={
              kind === 'away'
                ? Option.map(model.machine, (entry) => entry.machine.lastSeenAt)
                : model.endedAt
            }
            now={now}
            restart={kind === 'away' ? Option.none() : restart}
            onBack={back}
            backLabel={backLabel}
            takeFocus={composerFocused}
          />
        ),
        onNone: () => (
          <div
            className="grid gap-2"
            onFocus={() => {
              setComposerFocused(true)
            }}
            onBlur={() => {
              setComposerFocused(false)
            }}
          >
            {Option.match(
              Option.filter(model.row, () => blocked),
              { onNone: () => null, onSome: (row) => <AskSlot row={row} /> },
            )}
            <Composer
              value={draft}
              onValueChange={onDraftChange}
              onSend={send}
              onStop={() => {
                actions.stop.send(interrupt(pane), STOP_FINGERPRINT)
              }}
              mode={mode}
              working={activity === 'working'}
              disabled={!connection.canAct || askless || model.presence === 'loading'}
              sending={isSending(actions.prompt.state)}
              placeholder={placeholderOf(connection, mode, blocked)}
              label={mode === 'decline' ? 'Tell Claude what to do instead' : 'Message to Claude'}
              failure={Option.orElse(failureOf(actions.prompt), () => failureOf(actions.stop))}
            />
          </div>
        ),
      })}
    </div>
  )
}

function ChatBody({ machine, pane }: { machine: MachineId; pane: PaneId }) {
  const navigate = useNavigate()
  const opened = React.useMemo(() => new OpenedAgent({ machine, pane }), [machine, pane])
  const transcriptKey = React.useMemo(
    () => new PaneTranscriptKey({ machine, pane }),
    [machine, pane],
  )
  const model = useAtomValue(chatScreenAtom(opened))
  const connection = useAtomValue(connectionAtom)
  const view = useTranscript(transcriptKey)
  const showWhole = useAtomSet(paneTranscriptWholeAtom(transcriptKey))
  const fromMachine = useOpenedFromMachine()
  const now = useNow()
  const thread = React.useRef<ThreadHandle>(null)
  const [draft, setDraft] = React.useState('')
  const actions: ChatActions = {
    prompt: useCommandAction(machine),
    stop: useCommandAction(machine),
    restart: useCommandAction(machine),
  }
  const activity = activityOf(model)
  const cwd = Option.match(model.row, { onNone: () => '', onSome: (row) => row.cwd })
  const subagents = Option.match(view, { onNone: () => [], onSome: (found) => found.subagents })
  const lines = Option.match(view, { onNone: () => [], onSome: (found) => found.lines })
  const items = React.useMemo(
    () => chatItems(lines, { cwd, activity, subagents }),
    [lines, cwd, activity, subagents],
  )
  const backLabel = fromMachine ? `Back to ${machineLabelOf(model)}` : BACK_TO_AGENTS

  useAtomMount(seenWhileOpenAtom(opened))
  useClearSentDraft(actions.prompt, draft, setDraft)
  useRestartInPlace(machine, actions.restart)

  const environment: ThreadEnvironment = {
    now,
    cwd,
    paneClosed: model.presence === 'closed',
    onShowEarlier: () => {
      showWhole(true)
    },
    onOpenRun: (run: SubagentRun) => {
      Option.map(run.subagent, (subagent) => {
        void navigate({
          to: '/m/$machine/p/$pane/sub/$session/$subagent',
          params: { machine, pane, session: run.session, subagent },
        })
      })
    },
  }

  const working = Option.filter(model.row, () => activity === 'working' && !hasToolRunning(items))
  const rows: readonly ThreadRow[] =
    model.presence === 'notClaude'
      ? []
      : [
          ...itemRows(items, environment),
          ...pendingPromptRows(actions.prompt, items),
          ...Option.toArray(
            Option.map(working, (row) => workingRow(shortElapsed(now, row.statusChangedAt))),
          ),
          ...failureRows(view),
        ]

  return (
    <>
      <PushedHeader
        title={Option.match(model.row, { onNone: () => pane, onSome: agentTitleOrPane })}
        subtitle={<ChatStatusLine status={chatStatus(model)} place={placeOf(model)} />}
        backLabel={backLabel}
        trailing={
          <RunningPill
            count={runningCount(items)}
            onShow={() => {
              Option.map(firstRunningTree(items), (key) => {
                thread.current?.scrollToKey(key)
              })
            }}
          />
        }
      />
      <div className="min-h-0 flex-1">
        <WithHighlighter>
          <Thread
            handle={thread}
            rows={rows}
            dimmed={model.presence === 'away' || connection.stale}
            empty={emptyThread(model, view)}
          />
        </WithHighlighter>
      </div>
      <ChatDock
        pane={pane}
        model={model}
        connection={connection}
        actions={actions}
        draft={draft}
        onDraftChange={setDraft}
        now={now}
        backLabel={backLabel}
      />
    </>
  )
}

export function AgentChatScreen({ machine, pane }: { machine: MachineId; pane: PaneId }) {
  return (
    <PushedScreen>
      <ChatBody machine={machine} pane={pane} />
    </PushedScreen>
  )
}
