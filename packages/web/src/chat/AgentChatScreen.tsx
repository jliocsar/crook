import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import { pendingAskSummary } from '@crook/domain/AgentRow'
import type { AgentRow } from '@crook/domain/AgentRow'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { chatScreenAtom } from '@crook/web/atoms/Chat'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { OpenedAgent, seenWhileOpenAtom } from '@crook/web/atoms/Herd'
import {
  paneTranscriptAtom,
  PaneTranscriptKey,
  paneTranscriptWholeAtom,
  transcriptRetryAtom,
} from '@crook/web/atoms/Transcript'
import { useChatCommands } from '@crook/web/chat/ChatCommands'
import type { ComposerCommands } from '@crook/web/chat/ChatCommands'
import { ChatStatusLine, RunningPill } from '@crook/web/chat/ChatHeader'
import {
  chatItems,
  firstRunningTreeKey,
  hasToolRunning,
  runningCount,
} from '@crook/web/chat/ChatItems'
import type { SubagentRun } from '@crook/web/chat/ChatItems'
import {
  activityOf,
  chatStatus,
  cwdOf,
  edgeKindOf,
  isWatching,
  machineLabelOf,
  placeOf,
  titleOf,
} from '@crook/web/chat/ChatModel'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'
import {
  failureRows,
  itemRows,
  LoadingThread,
  NO_MESSAGES,
  QuietThread,
  workingRow,
} from '@crook/web/chat/ChatRows'
import { Composer } from '@crook/web/chat/Composer'
import { EdgeCard } from '@crook/web/chat/EdgeCard'
import type { Restart } from '@crook/web/chat/EdgeCard'
import { useKeyboardInset } from '@crook/web/chat/KeyboardInset'
import { Thread } from '@crook/web/chat/Thread'
import type { ThreadHandle, ThreadRow } from '@crook/web/chat/Thread'
import type { ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import { linesOf, subagentsOf } from '@crook/web/chat/TranscriptState'
import type { TranscriptView } from '@crook/web/chat/TranscriptState'
import { EmptyState } from '@crook/web/components/ui/empty-state'
import { Message } from '@crook/web/components/ui/message'
import { useOpenedFromMachine } from '@crook/web/navigation/ChatOrigin'
import { PushedHeader, PushedScreen, usePushedScreen } from '@crook/web/navigation/PushedScreen'
import { shortElapsed } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

interface DockProps {
  readonly model: ChatScreenModel
  readonly composer: ComposerCommands
  readonly blocked: boolean
  readonly restart: Option.Option<Restart>
  readonly draft: string
  readonly onDraftChange: (draft: string) => void
  readonly now: DateTime.Utc
  readonly onBack: () => void
  readonly backLabel: string
}

const BACK_TO_AGENTS = 'Back to Agents'
const NOT_CLAUDE = 'Not a Claude pane'
const PENDING_PROMPT_KEY = 'pending prompt'

const pendingPromptRows = (text: Option.Option<string>): readonly ThreadRow[] =>
  Option.toArray(
    Option.map(text, (sent) => ({
      key: PENDING_PROMPT_KEY,
      content: (
        <Message role="user" meta="Sent">
          {sent}
        </Message>
      ),
    })),
  )

const emptyThread = (model: ChatScreenModel, view: Option.Option<TranscriptView>) => {
  if (model.presence === 'notClaude') {
    return <EmptyState title={NOT_CLAUDE} />
  }

  if (!isWatching(model)) {
    return null
  }

  return Option.isNone(view) ? <LoadingThread /> : <QuietThread>{NO_MESSAGES}</QuietThread>
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
  model,
  composer,
  blocked,
  restart,
  draft,
  onDraftChange,
  now,
  onBack,
  backLabel,
}: DockProps) {
  const inset = useKeyboardInset()
  const [composerFocused, setComposerFocused] = React.useState(false)

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
            onBack={onBack}
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
            <Composer value={draft} onValueChange={onDraftChange} {...composer} />
          </div>
        ),
      })}
    </div>
  )
}

function ChatBody({ machine, pane }: { machine: MachineId; pane: PaneId }) {
  const navigate = useNavigate()
  const { back } = usePushedScreen()
  const opened = React.useMemo(() => new OpenedAgent({ machine, pane }), [machine, pane])
  const transcriptKey = React.useMemo(
    () => new PaneTranscriptKey({ machine, pane }),
    [machine, pane],
  )
  const model = useAtomValue(chatScreenAtom(opened))
  const connection = useAtomValue(connectionAtom)
  const view = AsyncResult.value(useAtomValue(paneTranscriptAtom(transcriptKey)))
  const showWhole = useAtomSet(paneTranscriptWholeAtom(transcriptKey))
  const retry = useAtomSet(transcriptRetryAtom(transcriptKey))
  const fromMachine = useOpenedFromMachine()
  const now = useNow()
  const thread = React.useRef<ThreadHandle>(null)
  const [draft, setDraft] = React.useState('')
  const activity = activityOf(model)
  const cwd = cwdOf(model)
  const subagents = subagentsOf(view)
  const lines = linesOf(view)
  const items = React.useMemo(
    () => chatItems(lines, { cwd, activity, subagents }),
    [lines, cwd, activity, subagents],
  )
  const commands = useChatCommands({ machine, pane, model, connection, items, draft, setDraft })
  const backLabel = fromMachine ? `Back to ${machineLabelOf(model)}` : BACK_TO_AGENTS

  useAtomMount(seenWhileOpenAtom(opened))

  const environment: ThreadEnvironment = {
    now,
    cwd,
    paneClosed: model.presence === 'closed',
    onShowEarlier: () => {
      showWhole(true)
    },
    onOpenRun: (run: SubagentRun) => {
      if (Option.isSome(run.subagent)) {
        void navigate({
          to: '/m/$machine/p/$pane/sub/$session/$subagent',
          params: { machine, pane, session: run.session, subagent: run.subagent.value },
        })
      }
    },
  }

  const working = Option.filter(
    model.row,
    () => model.presence === 'live' && activity === 'working' && !hasToolRunning(items),
  )
  const rows: readonly ThreadRow[] =
    model.presence === 'notClaude'
      ? []
      : [
          ...itemRows(items, environment),
          ...pendingPromptRows(commands.pendingPrompt),
          ...Option.toArray(
            Option.map(working, (row) => workingRow(shortElapsed(now, row.statusChangedAt))),
          ),
          ...(isWatching(model)
            ? failureRows(view, () => {
                retry((count) => count + 1)
              })
            : []),
        ]

  return (
    <>
      <PushedHeader
        title={titleOf(model, pane)}
        subtitle={<ChatStatusLine status={chatStatus(model)} place={placeOf(model)} />}
        backLabel={backLabel}
        trailing={
          <RunningPill
            count={runningCount(items)}
            onShow={() => {
              const key = firstRunningTreeKey(items)

              if (Option.isSome(key)) {
                thread.current?.scrollToKey(key.value)
              }
            }}
          />
        }
      />
      <div className="min-h-0 flex-1">
        <Thread
          handle={thread}
          rows={rows}
          dimmed={model.presence === 'away' || connection.stale}
          empty={emptyThread(model, view)}
        />
      </div>
      <ChatDock
        model={model}
        composer={commands.composer}
        blocked={commands.blocked}
        restart={commands.restart}
        draft={draft}
        onDraftChange={setDraft}
        now={now}
        onBack={back}
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
