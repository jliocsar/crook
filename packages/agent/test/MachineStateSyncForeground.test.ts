import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { CheckoutHeads } from '@crook/agent/CheckoutHeads'
import { ClaudeSessionFiles } from '@crook/agent/ClaudeSessionFiles'
import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { PendingAsks } from '@crook/agent/PendingAsks'
import { RecentPlaces } from '@crook/agent/RecentPlaces'
import { NO_RUNNING_COUNTS, RunningSubagents } from '@crook/agent/RunningSubagents'
import { ClaudeSessionId } from '@crook/domain/Ids'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type ScriptedResponse,
  scriptedRejection,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import { PaneProcessInfoMethod, SessionSnapshotMethod } from '@crook/herdr/Methods'
import { agentInfo, sessionSnapshot } from '@crook/herdr/fixtures/Records.ts'
import {
  type AgentInfo,
  AgentSessionInfo,
  PaneProcess,
  PaneProcessInfo,
} from '@crook/herdr/Records'

const NO_FOREGROUND_JOB_REPLY =
  '{"id":"pane.process_info","result":{"type":"pane_process_info","process_info":{"pane_id":"w1:p1","shell_pid":3375068}}}'

const SESSION = ClaudeSessionId.make('cc70b540-d22a-4ea4-aaf9-a0db3ce151aa')

const noForegroundJob: ScriptedResponse = {
  method: PaneProcessInfoMethod.name,
  line: NO_FOREGROUND_JOB_REPLY,
}

const refusedWhileStopping = scriptedRejection(
  PaneProcessInfoMethod,
  'server_unavailable',
  'server is shutting down',
)

const foregroundWithoutClaude = scriptedResult(PaneProcessInfoMethod, {
  type: 'pane_process_info',
  process_info: new PaneProcessInfo({
    pane_id: 'w1:p1',
    foreground_processes: Option.some([new PaneProcess({ pid: 1232679, name: 'lx' })]),
  }),
})

const agentReportingSession = agentInfo({
  agent_session: Option.some(
    new AgentSessionInfo({ agent: 'claude', kind: 'id', source: 'herdr:claude', value: SESSION }),
  ),
})

const readingOf = (agent: AgentInfo) =>
  scriptedResult(SessionSnapshotMethod, {
    type: 'session_snapshot',
    snapshot: sessionSnapshot([agent]),
  })

const twoReads = Effect.fn('twoReads')(function* (
  secondAgent: AgentInfo,
  processInfo: ScriptedResponse,
) {
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const runningCounts = yield* SubscriptionRef.make(NO_RUNNING_COUNTS)
  const retained = yield* Queue.unbounded<readonly ClaudeSessionId[]>()
  const herdr = HerdrClient.layerTest({
    responses: [readingOf(agentReportingSession), readingOf(secondAgent), processInfo],
    events,
  })
  const sessionFiles = ClaudeSessionFiles.layerTest([SESSION])
  const context = yield* Layer.build(
    Layer.provideMerge(MachineStateSync.layer, [
      herdr,
      sessionFiles,
      Layer.provide(ClaudeSessions.layer, [herdr, sessionFiles]),
      CreatedPanes.layerTest(),
      RunningSubagents.layerTest(runningCounts, () => Effect.void),
      Layer.succeed(
        PendingAsks,
        PendingAsks.of({
          mark: Effect.succeed(0),
          askOf: () => Effect.succeedNone,
          retain: (sessions) => Queue.offer(retained, sessions),
          changes: Stream.empty,
        }),
      ),
      RecentPlaces.layerTest(),
      GitBranches.layerTest(new Map()),
      CheckoutHeads.layerTest(),
      ConfigProvider.layer(ConfigProvider.fromUnknown({ CROOK_MACHINE_ID: 'laptop' })),
    ]),
  )
  const state = yield* Context.get(context, MachineStateSync).changes.pipe(
    Stream.filter((next) => next.version === 1),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
  )

  return {
    sessions: state.agents.map((row) => row.claudeSession),
    retained: yield* Queue.takeAll(retained),
  }
})

layer(BunFileSystem.layer, { excludeTestServices: true })('A pane with no foreground job', (it) => {
  it.effect('keeps the session its row held for that terminal', () =>
    Effect.gen(function* () {
      const { sessions, retained } = yield* twoReads(
        agentInfo({ agent_status: 'idle' }),
        noForegroundJob,
      )

      expect(sessions).toEqual([Option.some(SESSION)])
      expect(retained).toEqual([[SESSION], [SESSION]])
    }),
  )

  it.effect('keeps none for another terminal in that pane', () =>
    Effect.gen(function* () {
      const { sessions } = yield* twoReads(
        agentInfo({ terminal_id: 'term_reopened' }),
        noForegroundJob,
      )

      expect(sessions).toEqual([Option.none()])
    }),
  )

  it.effect('loses it once the foreground is known and holds no claude', () =>
    Effect.gen(function* () {
      const { sessions, retained } = yield* twoReads(
        agentInfo({ agent_status: 'idle' }),
        foregroundWithoutClaude,
      )

      expect(sessions).toEqual([Option.none()])
      expect(retained).toEqual([[SESSION], []])
    }),
  )
})

layer(BunFileSystem.layer, { excludeTestServices: true })('A pane whose read failed', (it) => {
  it.effect('keeps the session its row held and what the hooks recorded for it', () =>
    Effect.gen(function* () {
      const { sessions, retained } = yield* twoReads(
        agentInfo({ agent_status: 'idle' }),
        refusedWhileStopping,
      )

      expect(sessions).toEqual([Option.some(SESSION)])
      expect(retained).toEqual([[SESSION], [SESSION]])
    }),
  )

  it.effect('keeps none for another terminal in that pane', () =>
    Effect.gen(function* () {
      const { sessions } = yield* twoReads(
        agentInfo({ terminal_id: 'term_reopened' }),
        refusedWhileStopping,
      )

      expect(sessions).toEqual([Option.none()])
    }),
  )
})
