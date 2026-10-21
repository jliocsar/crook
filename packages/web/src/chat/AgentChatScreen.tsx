import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { Ellipsis } from 'lucide-react'
import * as React from 'react'

import type { MachineId, PaneId } from '@crook/domain/Ids'
import { useClosedFromChat, useOpenAgentActions } from '@crook/web/actions/AgentActions'
import { chatScreenAtom } from '@crook/web/atoms/Chat'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { OpenedAgent, seenWhileOpenAtom } from '@crook/web/atoms/Herd'
import {
  PaneTranscriptKey,
  transcriptAtom,
  transcriptRetryAtom,
  transcriptWholeAtom,
} from '@crook/web/atoms/Transcript'
import { AskDock } from '@crook/web/chat/AskDock'
import { askAnnouncement, withAlwaysNotes, withoutAskedCall } from '@crook/web/chat/AskModel'
import { useChatCommands } from '@crook/web/chat/ChatCommands'
import type { AskDockCommands, ComposerCommands } from '@crook/web/chat/ChatCommands'
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
import { ImageViewer } from '@crook/web/chat/Images'
import { useKeyboardInset } from '@crook/web/chat/KeyboardInset'
import { Thread } from '@crook/web/chat/Thread'
import type { ThreadHandle, ThreadRow } from '@crook/web/chat/Thread'
import type { ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import { linesOf, subagentsOf } from '@crook/web/chat/TranscriptState'
import type { TranscriptView } from '@crook/web/chat/TranscriptState'
import { Button } from '@crook/web/components/ui/button'
import { Collapse } from '@crook/web/components/Collapse'
import { EmptyState } from '@crook/web/components/ui/empty-state'
import { Message } from '@crook/web/components/ui/message'
import { useOpenedFromMachine } from '@crook/web/navigation/ChatOrigin'
import { PushedHeader, PushedScreen, usePushedScreen } from '@crook/web/navigation/PushedScreen'
import { shortElapsed } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

interface DockProps {
  readonly model: ChatScreenModel
  readonly closedHere: boolean
  readonly composer: ComposerCommands
  readonly ask: Option.Option<AskDockCommands>
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
const ASK_DOCK_SELECTOR = '[data-slot="ask-dock"]'
const COMPOSER_FIELD_SELECTOR = '[data-slot="composer"] textarea'
const VISIBLE_FOCUS = ':focus-visible'

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

const hasActions = (model: ChatScreenModel): boolean =>
  Option.isSome(model.row) && (model.presence === 'live' || model.presence === 'away')

const holdsVisibleAskFocus = (target: EventTarget): boolean =>
  target instanceof Element &&
  target.closest(ASK_DOCK_SELECTOR) !== null &&
  target.matches(VISIBLE_FOCUS)

const useFocusAfterAsk = (container: React.RefObject<HTMLDivElement | null>, askKey: string) => {
  const askFocused = React.useRef(false)

  React.useEffect(() => {
    if (!askFocused.current) {
      return
    }

    askFocused.current = false

    const active = document.activeElement
    const lost =
      active === null || active === document.body || active.closest(ASK_DOCK_SELECTOR) !== null

    if (lost) {
      container.current?.querySelector<HTMLElement>(COMPOSER_FIELD_SELECTOR)?.focus()
    }
  }, [askKey])

  return {
    onFocus: (event: React.FocusEvent) => {
      askFocused.current = holdsVisibleAskFocus(event.target)
    },
    onBlur: (event: React.FocusEvent) => {
      if (event.relatedTarget !== null) {
        askFocused.current = holdsVisibleAskFocus(event.relatedTarget)
      }
    },
  }
}

function ChatDock({
  model,
  closedHere,
  composer,
  ask,
  restart,
  draft,
  onDraftChange,
  now,
  onBack,
  backLabel,
}: DockProps) {
  const inset = useKeyboardInset()
  const [composerFocused, setComposerFocused] = React.useState(false)
  const container = React.useRef<HTMLDivElement>(null)
  const askFocus = useFocusAfterAsk(
    container,
    Option.match(ask, { onNone: () => '', onSome: (dock) => dock.ask.id }),
  )

  if (model.presence === 'notClaude' || closedHere) {
    return null
  }

  return (
    <div
      ref={container}
      data-slot="chat-dock"
      className="border-border bg-card flex min-h-0 flex-col border-t px-3 pt-3 pb-[max(var(--safe-bottom),0.75rem)]"
      style={inset > 0 ? { paddingBottom: inset } : undefined}
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
            now={now}
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
                  <AskDock
                    key={dock.ask.id}
                    ask={dock.ask}
                    cwd={cwdOf(model)}
                    state={dock.state}
                    disabled={dock.disabled}
                    onAnswer={dock.onAnswer}
                  />
                ),
              })}
            </Collapse>
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
  const view = AsyncResult.value(useAtomValue(transcriptAtom(transcriptKey)))
  const showWhole = useAtomSet(transcriptWholeAtom(transcriptKey))
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
  const openActions = useOpenAgentActions()
  const closedHere = useClosedFromChat(machine, pane)
  const title = titleOf(model, pane)

  useAtomMount(seenWhileOpenAtom(opened))

  const openRun = (run: SubagentRun) => {
    if (Option.isSome(run.subagent)) {
      void navigate({
        to: '/m/$machine/p/$pane/sub/$session/$subagent',
        params: { machine, pane, session: run.session, subagent: run.subagent.value },
      })
    }
  }

  const environment: ThreadEnvironment = {
    now,
    cwd,
    paneClosed: model.presence === 'closed',
    onShowEarlier: () => {
      showWhole(true)
    },
    onOpenRun: Option.some(openRun),
  }

  const working = Option.filter(
    model.row,
    () => model.presence === 'live' && activity === 'working' && !hasToolRunning(items),
  )
  const rows: readonly ThreadRow[] =
    model.presence === 'notClaude'
      ? []
      : [
          ...itemRows(
            withoutAskedCall(
              withAlwaysNotes(items, commands.alwaysNotes),
              Option.map(commands.ask, (dock) => dock.ask.id),
            ),
            environment,
          ),
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
        title={title}
        subtitle={<ChatStatusLine status={chatStatus(model)} place={placeOf(model)} />}
        backLabel={backLabel}
        trailing={
          <>
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
        <Thread
          handle={thread}
          rows={rows}
          dimmed={model.presence === 'away' || connection.stale}
          empty={emptyThread(model, view)}
        />
      </div>
      <ChatDock
        model={model}
        closedHere={closedHere}
        composer={commands.composer}
        ask={commands.ask}
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
      <ImageViewer>
        <ChatBody machine={machine} pane={pane} />
      </ImageViewer>
    </PushedScreen>
  )
}
