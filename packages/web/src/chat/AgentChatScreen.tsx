import { useNavigate } from '@tanstack/react-router'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { Ellipsis } from 'lucide-react'
import * as React from 'react'

import type { MachineId, PaneId } from '@crook/domain/Ids'
import type { SkillListing } from '@crook/domain/Skill'
import { useClosedFromChat, useOpenAgentActions } from '@crook/web/actions/AgentActions'
import { PaneTranscriptKey } from '@crook/web/atoms/Transcript'
import { AskDock } from '@crook/web/chat/AskDock'
import { useFocusAfterAsk } from '@crook/web/chat/AskFocus'
import { askAnnouncement, withAlwaysNotes, withoutAskedCall } from '@crook/web/chat/AskModel'
import { useChatCommands } from '@crook/web/chat/ChatCommands'
import type {
  AskDockCommands,
  ComposerCommands,
  PendingPromptRow,
} from '@crook/web/chat/ChatCommands'
import { CatchingUpPill, ChatStatusLine, RunningPill } from '@crook/web/chat/ChatHeader'
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
import { failureRows, itemRows, TranscriptEmpty, workingRow } from '@crook/web/chat/ChatRows'
import { Composer } from '@crook/web/chat/Composer'
import { EdgeCard } from '@crook/web/chat/EdgeCard'
import type { Restart } from '@crook/web/chat/EdgeCard'
import { ImageViewer } from '@crook/web/chat/Images'
import { useOpenedChat, useTranscriptThread } from '@crook/web/chat/OpenedChat'
import { Thread } from '@crook/web/chat/Thread'
import type { ThreadHandle, ThreadRow } from '@crook/web/chat/Thread'
import type { ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import { isCatchingUp, linesOf, rostersOf, skillsOf } from '@crook/web/chat/TranscriptState'
import type { TranscriptView } from '@crook/web/chat/TranscriptState'
import { Button } from '@crook/web/components/ui/button'
import { Collapse } from '@crook/web/components/Collapse'
import { EmptyState } from '@crook/web/components/ui/empty-state'
import { Message } from '@crook/web/components/ui/message'
import { useOpenedFromMachine } from '@crook/web/navigation/ChatOrigin'
import { useCoveredByPushedScreen } from '@crook/web/navigation/Pushed'
import { PushedHeader, PushedScreen, usePushedScreen } from '@crook/web/navigation/PushedScreen'
import { shortElapsed } from '@crook/web/time/Elapsed'

interface DockProps {
  readonly model: ChatScreenModel
  readonly closedHere: boolean
  readonly composer: ComposerCommands
  readonly skills: readonly SkillListing[]
  readonly ask: Option.Option<AskDockCommands>
  readonly restart: Option.Option<Restart>
  readonly draft: string
  readonly onDraftChange: (draft: string) => void
  readonly onBack: () => void
  readonly backLabel: string
}

const BACK_TO_AGENTS = 'Back to Agents'
const NOT_CLAUDE = 'Not a Claude pane'

const pendingPromptRows = (pending: readonly PendingPromptRow[]): readonly ThreadRow[] =>
  pending.map((prompt) => ({
    key: prompt.key,
    content: <Message meta={prompt.queued ? 'Queued' : 'Sent'}>{prompt.text}</Message>,
  }))

const emptyThread = (model: ChatScreenModel, view: Option.Option<TranscriptView>) => {
  if (model.presence === 'notClaude') {
    return <EmptyState title={NOT_CLAUDE} />
  }

  if (!isWatching(model)) {
    return null
  }

  return <TranscriptEmpty view={view} />
}

const hasActions = (model: ChatScreenModel): boolean =>
  Option.isSome(model.row) && (model.presence === 'live' || model.presence === 'away')

function ChatDock({
  model,
  closedHere,
  composer,
  skills,
  ask,
  restart,
  draft,
  onDraftChange,
  onBack,
  backLabel,
}: DockProps) {
  const [composerFocused, setComposerFocused] = React.useState(false)
  const askFocus = useFocusAfterAsk(
    Option.match(ask, { onNone: () => '', onSome: (dock) => dock.ask.id }),
  )

  if (model.presence === 'notClaude' || closedHere) {
    return null
  }

  return (
    <div
      data-slot="chat-dock"
      className="border-border bg-card flex min-h-0 flex-col border-t px-3 pt-3 pb-[max(var(--safe-bottom),0.75rem)] in-data-[keyboard=open]:pb-3"
    >
      <p role="status" className="sr-only">
        {Option.match(ask, { onNone: () => '', onSome: (dock) => askAnnouncement(dock.ask) })}
      </p>
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
            restart={kind === 'away' ? Option.none() : restart}
            onBack={onBack}
            backLabel={backLabel}
            takeFocus={composerFocused}
          />
        ),
        onNone: () => (
          <div
            className="flex min-h-0 flex-col gap-2"
            onFocus={(event) => {
              setComposerFocused(true)
              askFocus.onFocus(event)
            }}
            onBlur={(event) => {
              setComposerFocused(false)
              askFocus.onBlur(event)
            }}
          >
            <Collapse open={Option.isSome(ask)} className="flex min-h-0 flex-col">
              {Option.match(ask, {
                onNone: () => null,
                onSome: (dock) => (
                  <AskDock key={dock.ask.id} ref={askFocus.region} cwd={cwdOf(model)} {...dock} />
                ),
              })}
            </Collapse>
            <Composer
              handle={askFocus.composer}
              value={draft}
              onValueChange={onDraftChange}
              skills={skills}
              {...composer}
            />
          </div>
        ),
      })}
    </div>
  )
}

function ChatBody({ machine, pane }: { machine: MachineId; pane: PaneId }) {
  const navigate = useNavigate()
  const { back } = usePushedScreen()
  const { opened, model, connection, dimmed } = useOpenedChat(machine, pane)
  const transcriptKey = React.useMemo(
    () => new PaneTranscriptKey({ machine, pane }),
    [machine, pane],
  )
  const transcript = useTranscriptThread(transcriptKey)
  const latest = AsyncResult.value(transcript.result)
  const view = AsyncResult.value(React.useDeferredValue(transcript.result))
  const catchingUp = isWatching(model) && isCatchingUp(latest)
  const fromMachine = useOpenedFromMachine()
  const thread = React.useRef<ThreadHandle>(null)
  const [draft, setDraft] = React.useState('')
  const activity = activityOf(model)
  const cwd = cwdOf(model)
  const rosters = rostersOf(view)
  const lines = linesOf(view)
  const items = React.useMemo(
    () => chatItems(lines, { cwd, activity, rosters }),
    [lines, cwd, activity, rosters],
  )
  const covered = useCoveredByPushedScreen()
  const scrollToEnd = React.useCallback(() => {
    thread.current?.scrollToEnd()
  }, [])
  const commands = useChatCommands({
    opened,
    model,
    connection,
    items,
    draft,
    setDraft,
    onPromptSent: scrollToEnd,
  })
  const backLabel = fromMachine ? `Back to ${machineLabelOf(model)}` : BACK_TO_AGENTS
  const openActions = useOpenAgentActions()
  const closedHere = useClosedFromChat(machine, pane)
  const title = titleOf(model, pane)

  React.useEffect(() => {
    if (!covered) {
      scrollToEnd()
    }
  }, [covered, scrollToEnd])

  const paneClosed = model.presence === 'closed'
  const askedCall = Option.getOrUndefined(Option.map(commands.ask, (dock) => dock.ask.id))
  const openRun = React.useCallback(
    (run: SubagentRun) => {
      if (Option.isSome(run.subagent)) {
        void navigate({
          to: '/m/$machine/p/$pane/sub/$session/$subagent',
          params: { machine, pane, session: run.session, subagent: run.subagent.value },
        })
      }
    },
    [navigate, machine, pane],
  )
  const environment = React.useMemo<ThreadEnvironment>(
    () => ({
      cwd,
      paneClosed,
      onShowEarlier: transcript.onShowEarlier,
      earlierPending: transcript.whole && catchingUp,
      onOpenRun: Option.some(openRun),
    }),
    [cwd, paneClosed, transcript.onShowEarlier, transcript.whole, catchingUp, openRun],
  )
  const conversationRows = React.useMemo(
    () =>
      itemRows(
        withoutAskedCall(
          withAlwaysNotes(items, commands.alwaysNotes),
          Option.fromUndefinedOr(askedCall),
        ),
        environment,
      ),
    [items, commands.alwaysNotes, askedCall, environment],
  )

  const working = Option.filter(
    model.row,
    () => model.presence === 'live' && activity === 'working' && !hasToolRunning(items),
  )
  const rows: readonly ThreadRow[] =
    model.presence === 'notClaude'
      ? []
      : [
          ...conversationRows,
          ...pendingPromptRows(commands.pendingPrompts),
          ...Option.toArray(
            Option.map(working, (row) =>
              workingRow((now) => shortElapsed(now, row.statusChangedAt)),
            ),
          ),
          ...(isWatching(model) ? failureRows(latest, transcript.onRetry) : []),
        ]

  return (
    <>
      <PushedHeader
        title={title}
        subtitle={<ChatStatusLine status={chatStatus(model)} place={placeOf(model)} />}
        backLabel={backLabel}
        trailing={
          <>
            <CatchingUpPill shown={catchingUp && !dimmed} />
            <RunningPill
              count={runningCount(items)}
              onShow={() => {
                const key = firstRunningTreeKey(items)

                if (Option.isSome(key)) {
                  thread.current?.scrollToKey(key.value)
                }
              }}
            />
            {hasActions(model) && !closedHere ? (
              <Button
                variant="ghost"
                size="icon-touch"
                data-slot="chat-actions"
                aria-label={`Actions for ${title}`}
                className="text-muted-foreground shrink-0"
                onClick={() => {
                  openActions(machine, pane, 'chat')
                }}
              >
                <Ellipsis className="size-5" aria-hidden="true" />
              </Button>
            ) : null}
          </>
        }
      />
      <div className="min-h-0 flex-1">
        <Thread handle={thread} rows={rows} dimmed={dimmed} empty={emptyThread(model, view)} />
      </div>
      <ChatDock
        model={model}
        closedHere={closedHere}
        composer={commands.composer}
        skills={skillsOf(view)}
        ask={commands.ask}
        restart={commands.restart}
        draft={draft}
        onDraftChange={setDraft}
        onBack={back}
        backLabel={backLabel}
      />
    </>
  )
}

export function AgentChatScreen({ machine, pane }: { machine: MachineId; pane: PaneId }) {
  return (
    <PushedScreen>
      <ImageViewer>
        <ChatBody machine={machine} pane={pane} />
      </ImageViewer>
    </PushedScreen>
  )
}
