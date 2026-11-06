import { useAtomValue } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import { cn } from 'cn'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import { Ellipsis } from 'lucide-react'
import * as React from 'react'

import type { ClaudeSessionId, MachineId, PaneId } from '@crook/domain/Ids'
import type { SkillListing } from '@crook/domain/Skill'
import { useClosedFromChat, useOpenAgentActions } from '@crook/web/actions/AgentActions'
import { linkAnsweredAtom } from '@crook/web/atoms/Connection'
import { PaneTranscriptKey } from '@crook/web/atoms/Transcript'
import { askAnswerNotice, AskDock } from '@crook/web/chat/AskDock'
import { useFocusAfterAsk } from '@crook/web/chat/AskFocus'
import { activityMachine, activityView } from '@crook/web/chat/ActivityMachine'
import {
  BackgroundContext,
  BackgroundDock,
  useBackgroundWork,
} from '@crook/web/chat/BackgroundDock'
import type { BackgroundJob } from '@crook/web/chat/BackgroundModel'
import { askAnnouncement, withAlwaysNotes, withoutAskedCall } from '@crook/web/chat/AskModel'
import { useCatchUp } from '@crook/web/chat/CatchUpDivider'
import { useChatCommands } from '@crook/web/chat/ChatCommands'
import type {
  AskDockCommands,
  ComposerCommands,
  ComposerStatus,
  PendingPromptRow,
} from '@crook/web/chat/ChatCommands'
import { CatchingUpCapsule } from '@crook/web/chat/CatchingUpCapsule'
import { ChatStatusLine } from '@crook/web/chat/ChatHeader'
import type { SubagentRun } from '@crook/web/chat/ChatItems'
import {
  chatStatus,
  cwdOf,
  edgeKindOf,
  endedAtOf,
  isWatching,
  machineLabelOf,
  placeOf,
  titleOf,
} from '@crook/web/chat/ChatModel'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'
import { summaryRows, useEpisodeSummary } from '@crook/web/chat/BackgroundSummary'
import { failureRows, useItemRows, workingRow } from '@crook/web/chat/ChatRows'
import { Composer } from '@crook/web/chat/Composer'
import {
  composerFailureMachine,
  composerFailureMessage,
} from '@crook/web/chat/ComposerFailureMachine'
import { isPresent, presenceMachine, PresenceState } from '@crook/web/chat/PresenceMachine'
import { EdgeCard } from '@crook/web/chat/EdgeCard'
import type { Restart } from '@crook/web/chat/EdgeCard'
import { ImageViewer } from '@crook/web/chat/Images'
import {
  useChatActivity,
  useChatItems,
  useOpenedChat,
  useTranscriptThread,
} from '@crook/web/chat/OpenedChat'
import { Thread } from '@crook/web/chat/Thread'
import type { ThreadHandle, ThreadRow } from '@crook/web/chat/Thread'
import { useThreadContent } from '@crook/web/chat/ThreadEmpty'
import type { ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import {
  hasFailed,
  isLoadingEarlier,
  saysCatchingUp,
  shownOf,
  skillsOf,
  threadSessionOf,
  transcriptMachine,
} from '@crook/web/chat/TranscriptMachine'
import { linesOf, rostersOf } from '@crook/web/chat/TranscriptState'
import { Button } from '@crook/web/components/ui/button'
import { Collapse } from '@crook/web/components/Collapse'
import { failureNotice, FloatingNotices } from '@crook/web/components/FloatingNotices'
import type { FloatingNotice } from '@crook/web/components/FloatingNotices'
import { Message } from '@crook/web/components/ui/message'
import { stateMark } from '@crook/web/machine/Machine'
import { useOpenedFromMachine } from '@crook/web/navigation/ChatOrigin'
import { useCoveredByPushedScreen } from '@crook/web/navigation/Pushed'
import { PushedHeader, PushedScreen, usePushedScreen } from '@crook/web/navigation/PushedScreen'
import { shortElapsed } from '@crook/web/time/Elapsed'

interface DockProps {
  readonly model: ChatScreenModel
  readonly closedHere: boolean
  readonly composer: ComposerCommands
  readonly status: ComposerStatus
  readonly skills: readonly SkillListing[]
  readonly ask: Option.Option<AskDockCommands>
  readonly restart: Option.Option<Restart>
  readonly draft: string
  readonly onDraftChange: (draft: string) => void
  readonly onBack: () => void
  readonly backLabel: string
}

const BACK_TO_AGENTS = 'Back to Agents'

const pendingPromptRows = (pending: readonly PendingPromptRow[]): readonly ThreadRow[] =>
  pending.map((prompt) => ({
    key: prompt.key,
    content: <Message meta={prompt.queued ? 'Queued' : 'Sent'}>{prompt.text}</Message>,
  }))

const composerNotices = (
  status: ComposerStatus,
  ask: Option.Option<AskDockCommands>,
): readonly FloatingNotice[] =>
  Arr.getSomes([
    Option.flatMap(ask, (dock) => askAnswerNotice(dock.state)),
    Option.map(composerFailureMessage(status.failure), (text): FloatingNotice => ({
      id: 'composer-failure',
      tone: 'failure',
      text,
    })),
    Option.map(status.note, (text): FloatingNotice => ({
      id: 'composer-note',
      tone: 'quiet',
      text,
      slot: 'composer-note',
    })),
  ])

const restartNotices = (restart: Option.Option<Restart>): readonly FloatingNotice[] =>
  Option.toArray(
    failureNotice(
      'restart-failure',
      Option.flatMap(restart, (found) => found.failure),
    ),
  )

const hasActions = (model: ChatScreenModel): boolean =>
  Option.isSome(model.row) &&
  (isPresent(model.presence) || PresenceState.guards.Away(model.presence))

const useThreadEpoch = (session: Option.Option<ClaudeSessionId>): number => {
  const [thread, setThread] = React.useState({ session, epoch: 0 })

  if (!Equal.equals(thread.session, session)) {
    setThread({ session, epoch: Option.isSome(thread.session) ? thread.epoch + 1 : thread.epoch })
  }

  return thread.epoch
}

function ChatDock({
  model,
  closedHere,
  composer,
  status,
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

  const edgeKind = edgeKindOf(model)
  const edgeShown = Option.isSome(edgeKind)

  React.useEffect(() => {
    if (edgeShown) {
      setComposerFocused(false)
    }
  }, [edgeShown])

  if (PresenceState.guards.NotClaude(model.presence) || closedHere) {
    return null
  }

  return (
    <div
      data-slot="chat-dock"
      {...stateMark(presenceMachine, model.presence)}
      className="border-border bg-card relative z-10 flex min-h-0 flex-col border-t px-3 pt-3 pb-[max(var(--safe-bottom),0.75rem)] in-data-[keyboard=open]:pb-3"
    >
      <div className="contents" {...stateMark(composerFailureMachine, status.failure)}>
        <FloatingNotices
          notices={edgeShown ? restartNotices(restart) : composerNotices(status, ask)}
        />
      </div>
      <p role="status" className="sr-only">
        {Option.match(ask, { onNone: () => '', onSome: (dock) => askAnnouncement(dock.ask) })}
      </p>
      <div className="grid min-h-0 grid-cols-1">
        <div
          className={cn(
            'col-start-1 row-start-1 flex min-h-0 flex-col gap-2',
            edgeShown && 'invisible',
          )}
          inert={edgeShown}
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
        {Option.match(edgeKind, {
          onNone: () => null,
          onSome: (kind) => (
            <EdgeCard
              className="col-start-1 row-start-1"
              kind={kind}
              machineLabel={machineLabelOf(model)}
              since={
                kind === 'away'
                  ? Option.map(model.machine, (machine) => machine.lastSeenAt)
                  : endedAtOf(model)
              }
              restart={kind === 'away' ? Option.none() : restart}
              onBack={onBack}
              backLabel={backLabel}
              takeFocus={composerFocused}
            />
          ),
        })}
      </div>
    </div>
  )
}

function ChatBody({ machine, pane }: { machine: MachineId; pane: PaneId }) {
  const navigate = useNavigate()
  const { back } = usePushedScreen()
  const { opened, model, canAct, dimmed } = useOpenedChat(machine, pane)
  const transcriptKey = React.useMemo(
    () => new PaneTranscriptKey({ machine, pane }),
    [machine, pane],
  )
  const transcript = useTranscriptThread(transcriptKey)
  const state = React.useDeferredValue(transcript.state)
  const view = React.useMemo(() => shownOf(state), [state])
  const catchingUp = isWatching(model) && saysCatchingUp(state)
  const fromMachine = useOpenedFromMachine()
  const thread = React.useRef<ThreadHandle>(null)
  const [draft, setDraft] = React.useState('')
  const cwd = cwdOf(model)
  const rosters = rostersOf(view)
  const lines = linesOf(view)
  const session = threadSessionOf(state)
  const threadEpoch = useThreadEpoch(session)
  const activity = useChatActivity(model, lines, hasFailed(state))
  const { workingSince, itemActivity } = activityView(activity)
  const items = useChatItems(lines, { cwd, activity: itemActivity, rosters })
  const covered = useCoveredByPushedScreen()
  const scrollToEnd = React.useCallback(() => {
    thread.current?.scrollToEnd()
  }, [])
  const commands = useChatCommands({
    opened,
    model,
    activity,
    canAct,
    items,
    session,
    threadEpoch,
    skills: skillsOf(state),
    draft,
    setDraft,
    onPromptSent: scrollToEnd,
  })
  const backLabel = fromMachine ? `Back to ${machineLabelOf(model)}` : BACK_TO_AGENTS
  const openActions = useOpenAgentActions()
  const closedHere = useClosedFromChat(machine, pane)
  const title = titleOf(model)
  const linkAnswered = useAtomValue(linkAnsweredAtom)

  React.useLayoutEffect(() => {
    if (!covered) {
      scrollToEnd()
    }
  }, [covered, scrollToEnd])

  const paneClosed = PresenceState.guards.Closed(model.presence)
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
  const openSubagentJob = React.useCallback(
    (job: BackgroundJob) => {
      if (Option.isSome(job.subagent) && Option.isSome(session)) {
        void navigate({
          to: '/m/$machine/p/$pane/sub/$session/$subagent',
          params: { machine, pane, session: session.value, subagent: job.subagent.value },
        })
      }
    },
    [navigate, machine, pane, session],
  )
  const backgroundWork = useBackgroundWork(view, items, openSubagentJob)
  const backgroundContext = React.useMemo(() => Option.some(backgroundWork), [backgroundWork])
  const episodeSummary = useEpisodeSummary(backgroundWork, lines)
  const earlierPending = isLoadingEarlier(state)
  const environment = React.useMemo<ThreadEnvironment>(
    () => ({
      cwd,
      paneClosed,
      onShowEarlier: transcript.onShowEarlier,
      earlierPending,
      onOpenRun: Option.some(openRun),
    }),
    [cwd, paneClosed, transcript.onShowEarlier, earlierPending, openRun],
  )
  const shownItems = React.useMemo(
    () =>
      withoutAskedCall(
        withAlwaysNotes(items, commands.alwaysNotes),
        Option.fromUndefinedOr(askedCall),
      ),
    [items, commands.alwaysNotes, askedCall],
  )
  const conversationRows = useItemRows(shownItems, environment)
  const landedRows = useCatchUp(view, conversationRows)
  const workingAt = Option.getOrUndefined(workingSince)
  const watching = isWatching(model)
  const notClaude = PresenceState.guards.NotClaude(model.presence)
  const rows = React.useMemo(
    (): readonly ThreadRow[] =>
      notClaude
        ? []
        : [
            ...landedRows,
            ...(commands.pendingPrompts.length === 0
              ? summaryRows(episodeSummary, backgroundWork.open)
              : []),
            ...pendingPromptRows(commands.pendingPrompts),
            ...(workingAt === undefined ? [] : [workingRow((now) => shortElapsed(now, workingAt))]),
            ...(watching ? failureRows(state, transcript.onRetry) : []),
          ],
    [
      notClaude,
      landedRows,
      episodeSummary,
      backgroundWork.open,
      commands.pendingPrompts,
      workingAt,
      watching,
      state,
      transcript.onRetry,
    ],
  )
  const threadContent = useThreadContent(rows, model, state, transcript.started)

  return (
    <>
      <PushedHeader
        title={linkAnswered ? title : <span className="invisible">{title}</span>}
        subtitle={
          <span
            {...stateMark(activityMachine, activity)}
            className="flex min-w-0 items-center gap-1.5"
          >
            <ChatStatusLine status={chatStatus(model, activity)} place={placeOf(model)} />
          </span>
        }
        backLabel={backLabel}
        trailing={
          hasActions(model) && !closedHere ? (
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
          ) : null
        }
      />
      <BackgroundContext.Provider value={backgroundContext}>
        <div {...stateMark(transcriptMachine, state)} className="relative min-h-0 flex-1">
          <Thread
            key={threadEpoch}
            handle={thread}
            rows={threadContent.rows}
            dimmed={dimmed}
            empty={threadContent.empty}
          />
          <CatchingUpCapsule shown={catchingUp && !dimmed} />
        </div>
      </BackgroundContext.Provider>
      <BackgroundDock work={backgroundWork} />
      <ChatDock
        model={model}
        closedHere={closedHere}
        composer={commands.composer}
        status={commands.composerStatus}
        skills={skillsOf(state)}
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
