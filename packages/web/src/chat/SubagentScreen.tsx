import { useAtomValue } from '@effect/atom-react/Hooks'
import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import type { ClaudeSessionId, MachineId, PaneId, SubagentId } from '@crook/domain/Ids'
import {
  PaneTranscriptKey,
  SubagentTranscriptKey,
  transcriptAtom,
} from '@crook/web/atoms/Transcript'
import { chatItems, hasToolRunning, isUserPrompt, runsIn } from '@crook/web/chat/ChatItems'
import type { SubagentRun } from '@crook/web/chat/ChatItems'
import { CatchingUpPill } from '@crook/web/chat/ChatHeader'
import { activityOf, cwdOf, isWatching, titleOf } from '@crook/web/chat/ChatModel'
import { failureRows, itemRows, TranscriptEmpty, workingRow } from '@crook/web/chat/ChatRows'
import { ImageViewer } from '@crook/web/chat/Images'
import { useOpenedChat, useTranscriptThread } from '@crook/web/chat/OpenedChat'
import { Thread } from '@crook/web/chat/Thread'
import type { ThreadRow } from '@crook/web/chat/Thread'
import type { ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import { runStatusShown, runTicks } from '@crook/web/chat/ToolView'
import { isCatchingUp, linesOf, NO_ROSTERS, rostersOf } from '@crook/web/chat/TranscriptState'
import { Response } from '@crook/web/components/ui/response'
import { RunDot } from '@crook/web/components/ui/subagent-tree'
import { PushedHeader, PushedScreen } from '@crook/web/navigation/PushedScreen'
import { runningSpan, spanDuration } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

export interface SubagentScreenProps {
  readonly machine: MachineId
  readonly pane: PaneId
  readonly session: ClaudeSessionId
  readonly subagent: SubagentId
}

const ASKED_KEY = 'claude asked'
const SUBAGENT_TITLE = 'Subagent'

const findRun = (runs: readonly SubagentRun[], subagent: SubagentId): Option.Option<SubagentRun> =>
  Arr.findFirst(runs, (run) => Option.contains(run.subagent, subagent))

const runLine = (
  run: SubagentRun,
  status: SubagentRun['status'],
  ticks: boolean,
  now: DateTime.Utc,
): string =>
  pipe(
    [
      Option.some(status),
      runningSpan(run.startedAt, run.finishedAt, ticks, now),
      Option.liftPredicate(run.agentType, (type) => type !== ''),
      run.model,
    ],
    Arr.getSomes,
    Arr.join(' · '),
  )

const askedRow = (prompt: string): ThreadRow => ({
  key: ASKED_KEY,
  content: (
    <section
      aria-label="Claude asked"
      className="border-border bg-muted/40 grid gap-1 rounded-[var(--radius)] border px-3.5 py-3"
    >
      <p className="text-muted-foreground text-xs font-semibold">Claude asked</p>
      <Response className="text-sm">{prompt}</Response>
    </section>
  ),
})

function RunLine({ run, paneClosed }: { run: SubagentRun; paneClosed: boolean }) {
  const status = runStatusShown(run, paneClosed)
  const ticks = runTicks(run, paneClosed)
  const now = useNow(ticks)

  return <span className="truncate font-mono">{runLine(run, status, ticks, now)}</span>
}

export function SubagentScreen({ machine, pane, session, subagent }: SubagentScreenProps) {
  const { model, dimmed } = useOpenedChat(machine, pane)
  const parentKey = React.useMemo(() => new PaneTranscriptKey({ machine, pane }), [machine, pane])
  const key = React.useMemo(
    () => new SubagentTranscriptKey({ machine, session, subagent }),
    [machine, session, subagent],
  )
  const parent = AsyncResult.value(useAtomValue(transcriptAtom(parentKey)))
  const transcript = useTranscriptThread(key)
  const view = AsyncResult.value(transcript.result)
  const catchingUp = isWatching(model) && isCatchingUp(view)
  const cwd = cwdOf(model)
  const paneClosed = model.presence === 'closed'
  const parentLines = linesOf(parent)
  const parentRosters = rostersOf(parent)
  const parentActivity = activityOf(model)
  const run = React.useMemo(
    () =>
      findRun(
        runsIn(chatItems(parentLines, { cwd, activity: parentActivity, rosters: parentRosters })),
        subagent,
      ),
    [parentLines, cwd, parentActivity, parentRosters, subagent],
  )
  const running = Option.exists(run, (found) => runStatusShown(found, paneClosed) === 'running')
  const lines = linesOf(view)
  const items = React.useMemo(
    () => chatItems(lines, { cwd, activity: running ? 'working' : 'still', rosters: NO_ROSTERS }),
    [lines, cwd, running],
  )
  const firstPrompt = Arr.findFirst(items, isUserPrompt)
  const prompt = Option.orElse(
    Option.flatMap(run, (found) => Option.liftPredicate(found.prompt, (text) => text !== '')),
    () => Option.map(firstPrompt, (item) => item.text),
  )
  const shownItems = Arr.filter(items, (item) =>
    Option.match(firstPrompt, { onNone: () => true, onSome: (first) => first.key !== item.key }),
  )
  const parentTitle = titleOf(model, pane)

  const environment = React.useMemo<ThreadEnvironment>(
    () => ({
      cwd,
      paneClosed,
      onShowEarlier: transcript.onShowEarlier,
      earlierPending: transcript.whole && catchingUp,
      onOpenRun: Option.none(),
    }),
    [cwd, paneClosed, transcript.onShowEarlier, transcript.whole, catchingUp],
  )

  const rows: readonly ThreadRow[] = [
    ...Option.toArray(Option.map(prompt, askedRow)),
    ...itemRows(shownItems, environment),
    ...(Option.exists(run, (found) => runTicks(found, paneClosed)) && !hasToolRunning(shownItems)
      ? Option.toArray(
          Option.map(
            Option.flatMap(run, (found) => found.startedAt),
            (from) => workingRow((now) => spanDuration(from, now)),
          ),
        )
      : []),
    ...failureRows(view, transcript.onRetry),
  ]

  return (
    <PushedScreen>
      <ImageViewer>
        <PushedHeader
          title={Option.match(run, {
            onNone: () => SUBAGENT_TITLE,
            onSome: (found) => found.description,
          })}
          subtitle={Option.match(run, {
            onNone: () => undefined,
            onSome: (found) => (
              <>
                <RunDot status={runStatusShown(found, paneClosed)} />
                <RunLine run={found} paneClosed={paneClosed} />
              </>
            ),
          })}
          backLabel={`Back to ${parentTitle}`}
          trailing={<CatchingUpPill shown={catchingUp && !dimmed} />}
        />
        <div className="min-h-0 flex-1">
          <Thread rows={rows} dimmed={dimmed} empty={<TranscriptEmpty view={view} />} />
        </div>
        <div
          data-slot="chat-dock"
          className="border-border bg-card text-muted-foreground border-t px-4 pt-3 pb-[max(var(--safe-bottom),0.75rem)] text-center in-data-[keyboard=open]:pb-3 text-sm"
        >
          Subagents take no messages. Reply to Claude in its chat.
        </div>
      </ImageViewer>
    </PushedScreen>
  )
}
