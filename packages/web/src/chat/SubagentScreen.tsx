import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import { agentTitleOrPane } from '@crook/domain/AgentRow'
import type { ClaudeSessionId, MachineId, PaneId, SubagentId } from '@crook/domain/Ids'
import { chatScreenAtom } from '@crook/web/atoms/Chat'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { OpenedAgent, seenWhileOpenAtom } from '@crook/web/atoms/Herd'
import {
  paneTranscriptAtom,
  PaneTranscriptKey,
  subagentTranscriptAtom,
  SubagentTranscriptKey,
  subagentTranscriptWholeAtom,
} from '@crook/web/atoms/Transcript'
import { ChatItem, chatItems, hasToolRunning, runsIn } from '@crook/web/chat/ChatItems'
import type { SubagentRun } from '@crook/web/chat/ChatItems'
import { activityOf } from '@crook/web/chat/ChatModel'
import {
  failureRows,
  itemRows,
  LoadingThread,
  QuietThread,
  WithHighlighter,
  workingRow,
} from '@crook/web/chat/ChatRows'
import { Thread } from '@crook/web/chat/Thread'
import type { ThreadRow } from '@crook/web/chat/Thread'
import { runStatusShown } from '@crook/web/chat/ThreadItem'
import type { ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import { Response } from '@crook/web/components/ui/response'
import { RunDot } from '@crook/web/components/ui/subagent-tree'
import { PushedHeader, PushedScreen } from '@crook/web/navigation/PushedScreen'
import { spanDuration } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

export interface SubagentScreenProps {
  readonly machine: MachineId
  readonly pane: PaneId
  readonly session: ClaudeSessionId
  readonly subagent: SubagentId
}

const ASKED_KEY = 'claude asked'
const NO_MESSAGES = 'No messages yet'
const SUBAGENT_TITLE = 'Subagent'

const isUserPrompt = ChatItem.$is('UserPrompt')

const runWord = { running: 'running', done: 'done', failed: 'failed' } satisfies Record<
  SubagentRun['status'],
  string
>

const ignoreRun = (): void => undefined

const findRun = (runs: readonly SubagentRun[], subagent: SubagentId): Option.Option<SubagentRun> =>
  Arr.findFirst(runs, (run) => Option.contains(run.subagent, subagent))

const runLine = (run: SubagentRun, paneClosed: boolean, now: ThreadEnvironment['now']): string =>
  pipe(
    [
      Option.some(runWord[runStatusShown(run, paneClosed)]),
      Option.map(
        Option.all({
          from: run.startedAt,
          to: Option.orElse(run.finishedAt, () =>
            Option.liftPredicate(now, () => runStatusShown(run, paneClosed) === 'running'),
          ),
        }),
        ({ from, to }) => spanDuration(from, to),
      ),
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

export function SubagentScreen({ machine, pane, session, subagent }: SubagentScreenProps) {
  const opened = React.useMemo(() => new OpenedAgent({ machine, pane }), [machine, pane])
  const parentKey = React.useMemo(() => new PaneTranscriptKey({ machine, pane }), [machine, pane])
  const key = React.useMemo(
    () => new SubagentTranscriptKey({ machine, session, subagent }),
    [machine, session, subagent],
  )
  const model = useAtomValue(chatScreenAtom(opened))
  const connection = useAtomValue(connectionAtom)
  const parent = AsyncResult.value(useAtomValue(paneTranscriptAtom(parentKey)))
  const view = AsyncResult.value(useAtomValue(subagentTranscriptAtom(key)))
  const showWhole = useAtomSet(subagentTranscriptWholeAtom(key))
  const now = useNow()
  const cwd = Option.match(model.row, { onNone: () => '', onSome: (row) => row.cwd })
  const paneClosed = model.presence === 'closed'
  const parentLines = Option.match(parent, { onNone: () => [], onSome: (found) => found.lines })
  const parentRoster = Option.match(parent, {
    onNone: () => [],
    onSome: (found) => found.subagents,
  })
  const parentActivity = activityOf(model)
  const run = React.useMemo(
    () =>
      findRun(
        runsIn(chatItems(parentLines, { cwd, activity: parentActivity, subagents: parentRoster })),
        subagent,
      ),
    [parentLines, cwd, parentActivity, parentRoster, subagent],
  )
  const running = Option.exists(run, (found) => runStatusShown(found, paneClosed) === 'running')
  const lines = Option.match(view, { onNone: () => [], onSome: (found) => found.lines })
  const items = React.useMemo(
    () => chatItems(lines, { cwd, activity: running ? 'working' : 'still', subagents: [] }),
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
  const parentTitle = Option.match(model.row, { onNone: () => pane, onSome: agentTitleOrPane })

  useAtomMount(seenWhileOpenAtom(opened))

  const environment: ThreadEnvironment = {
    now,
    cwd,
    paneClosed,
    onShowEarlier: () => {
      showWhole(true)
    },
    onOpenRun: ignoreRun,
  }

  const rows: readonly ThreadRow[] = [
    ...Option.toArray(Option.map(prompt, askedRow)),
    ...itemRows(shownItems, environment),
    ...(running && !hasToolRunning(shownItems)
      ? Option.toArray(
          Option.map(
            Option.flatMap(run, (found) => found.startedAt),
            (from) => workingRow(spanDuration(from, now)),
          ),
        )
      : []),
    ...failureRows(view),
  ]

  return (
    <PushedScreen>
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
              <span className="truncate font-mono">{runLine(found, paneClosed, now)}</span>
            </>
          ),
        })}
        backLabel={`Back to ${parentTitle}`}
      />
      <div className="min-h-0 flex-1">
        <WithHighlighter>
          <Thread
            rows={rows}
            dimmed={model.presence === 'away' || connection.stale}
            empty={
              Option.isNone(view) ? <LoadingThread /> : <QuietThread>{NO_MESSAGES}</QuietThread>
            }
          />
        </WithHighlighter>
      </div>
      <div
        data-slot="chat-dock"
        className="border-border bg-card text-muted-foreground border-t px-4 pt-3 pb-[max(var(--safe-bottom),0.75rem)] text-center text-sm"
      >
        Subagents take no messages. Reply to Claude in its chat.
      </div>
    </PushedScreen>
  )
}
