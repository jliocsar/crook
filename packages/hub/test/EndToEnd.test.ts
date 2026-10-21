import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { CommandExecutor } from '@crook/agent/CommandExecutor'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { HookInbox } from '@crook/agent/HookInbox'
import * as HubLink from '@crook/agent/HubLink'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { PaneScreens } from '@crook/agent/PaneScreens'
import { PendingAsks } from '@crook/agent/PendingAsks'
import { RecentPlaces } from '@crook/agent/RecentPlaces'
import { TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { emptyHookLedger } from '@crook/claude/HookLedger'
import { LastTurn } from '@crook/claude/LastTurn'
import { TranscriptLocator } from '@crook/claude/TranscriptLocator'
import type { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { AnswerAsk, Approve, InputDelivered, Prompt } from '@crook/domain/Command'
import { findMachine } from '@crook/domain/HerdView'
import { IdempotencyKey, MachineId, PaneId, TerminalId } from '@crook/domain/Ids'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type ScriptedResponse,
  type SentRequest,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import {
  AgentPromptMethod,
  AgentSendKeysMethod,
  PaneReadMethod,
  SessionSnapshotMethod,
} from '@crook/herdr/Methods'
import { AgentInfo, PaneInfo, SessionSnapshot, TabInfo, WorkspaceInfo } from '@crook/herdr/Records'
import { ClientApi } from '@crook/protocol/ClientApi'
import { CLIENT_PATH } from '@crook/protocol/HubRoutes'

import {
  connect,
  discardingAgentAudit,
  hello,
  herdWhere,
  hubDialFor,
  ownerLogin,
  testHub,
} from './Fixtures'

interface HerdrScene {
  readonly status: AgentStatus
  readonly stateChangeSeq: number
  readonly screen: string
}

const PANE = PaneId.make('w1:p1')
const TERMINAL = TerminalId.make('term_65e4981ac9ff02')
const WORKSPACE = 'w1'
const TAB = 'w1:t1'
const CWD = '/home/jliocsar/Projects/crook-worktrees/e2e'
const BRANCH = 'feat/jc-94-e2e'
const TITLE = 'JC-94 End-to-end check'
const BLOCKED_SCREEN = '12-native-bash-t20'
const IDLE_SCREEN = ''

const SentLine = Schema.fromJsonString(
  Schema.Struct({ method: Schema.String, params: Schema.Unknown }),
)

const sentRequest = (request: SentRequest) => Schema.decodeSync(SentLine)(request.line)

const screenText = Effect.fn('screenText')(function* (name: string) {
  const fileSystem = yield* FileSystem.FileSystem

  return yield* fileSystem.readFileString(
    new URL(import.meta.resolve(`@crook/claude/fixtures/spike-80/screens/${name}.txt`)).pathname,
  )
})

const agentInfo = (scene: HerdrScene) =>
  new AgentInfo({
    pane_id: PANE,
    terminal_id: TERMINAL,
    workspace_id: WORKSPACE,
    tab_id: TAB,
    focused: true,
    revision: 3,
    agent_status: scene.status,
    state_change_seq: scene.stateChangeSeq,
    completion_seq: Option.none(),
    name: Option.none(),
    agent: Option.some('claude'),
    display_agent: Option.some('claude'),
    agent_session: Option.none(),
    title: Option.none(),
    terminal_title: Option.some(`✳ ${TITLE}`),
    terminal_title_stripped: Option.some(TITLE),
    cwd: Option.some(CWD),
    foreground_cwd: Option.none(),
  })

const snapshotOf = (scene: HerdrScene) =>
  new SessionSnapshot({
    version: '0.9.1',
    protocol: 22,
    focused_workspace_id: Option.none(),
    focused_tab_id: Option.none(),
    focused_pane_id: Option.none(),
    workspaces: [
      new WorkspaceInfo({
        workspace_id: WORKSPACE,
        number: 1,
        label: 'crook',
        focused: true,
        pane_count: 1,
        tab_count: 1,
        active_tab_id: TAB,
        agent_status: scene.status,
        worktree: Option.none(),
      }),
    ],
    tabs: [
      new TabInfo({
        tab_id: TAB,
        workspace_id: WORKSPACE,
        number: 1,
        label: '1 · claude',
        focused: true,
        pane_count: 1,
        agent_status: scene.status,
      }),
    ],
    panes: [
      new PaneInfo({
        pane_id: PANE,
        terminal_id: TERMINAL,
        workspace_id: WORKSPACE,
        tab_id: TAB,
        focused: true,
        revision: 3,
        agent_status: scene.status,
        agent: Option.some('claude'),
        display_agent: Option.some('claude'),
        agent_session: Option.none(),
        label: Option.none(),
        title: Option.none(),
        terminal_title: Option.none(),
        cwd: Option.some(CWD),
        foreground_cwd: Option.none(),
      }),
    ],
    agents: [agentInfo(scene)],
  })

const scriptFor = (scene: HerdrScene): readonly ScriptedResponse[] => [
  scriptedResult(SessionSnapshotMethod, { type: 'session_snapshot', snapshot: snapshotOf(scene) }),
  scriptedResult(PaneReadMethod, {
    type: 'pane_read',
    read: { pane_id: PANE, text: scene.screen, truncated: false },
  }),
  scriptedResult(AgentPromptMethod, { type: 'agent_prompted' }),
  scriptedResult(AgentSendKeysMethod, { type: 'ok' }),
]

const statusChanged = (status: AgentStatus): HerdrEvent => ({
  event: 'pane.agent_status_changed',
  data: {
    pane_id: PANE,
    workspace_id: WORKSPACE,
    agent_status: status,
    agent: Option.some('claude'),
    display_agent: Option.none(),
    title: Option.none(),
  },
})

const fakeHerdr = Effect.fn('fakeHerdr')(function* (first: HerdrScene) {
  const sent = yield* Queue.unbounded<SentRequest>()
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const clientShowing = (scene: HerdrScene) =>
    Effect.map(
      Layer.build(HerdrClient.layerTest({ responses: scriptFor(scene), events, sent })),
      (context) => Context.get(context, HerdrClient),
    )
  const shown = yield* Ref.make(yield* clientShowing(first))
  const herdr = Layer.succeed(
    HerdrClient,
    HerdrClient.of({
      request: (method, params) =>
        Effect.flatMap(Ref.get(shown), (client) => client.request(method, params)),
      snapshot: Effect.flatMap(Ref.get(shown), (client) => client.snapshot),
      subscribe: (subscriptions) =>
        Effect.flatMap(Ref.get(shown), (client) => client.subscribe(subscriptions)),
    }),
  )
  const change = (scene: HerdrScene) =>
    Effect.flatMap(clientShowing(scene), (client) => Ref.set(shown, client)).pipe(
      Effect.andThen(Queue.offer(events, statusChanged(scene.status))),
    )
  const sentMethods = (method: string) =>
    Effect.map(Queue.clear(sent), (requests) =>
      requests.map(sentRequest).filter((request) => request.method === method),
    )

  return { herdr, change, sentMethods }
})

const realAgentOver = Effect.fn('realAgentOver')(function* (
  machine: MachineId,
  herdr: Layer.Layer<HerdrClient>,
) {
  const ledger = yield* SubscriptionRef.make(emptyHookLedger)
  const foundation = Layer.mergeAll(
    herdr,
    CreatedPanes.layerTest(),
    GitBranches.layerTest(new Map([[CWD, BRANCH]])),
    discardingAgentAudit,
    BunFileSystem.layer,
    Path.layer,
    ConfigProvider.layer(ConfigProvider.fromUnknown({ CROOK_MACHINE_ID: machine })),
  )
  const pendingAsks = Layer.provide(PendingAsks.layerFromServices, [
    HookInbox.layerTest(ledger),
    TranscriptLocator.layerAt([]),
    LastTurn.layer,
    PaneScreens.layer,
  ])
  const sync = Layer.provide(MachineStateSync.layer, [
    pendingAsks,
    ClaudeSessions.layerTest(new Map()),
    RecentPlaces.layerTest(),
  ])

  return Layer.provide(
    HubLink.layerWith(yield* hubDialFor(machine), hello),
    Layer.provideMerge(
      Layer.mergeAll(CommandExecutor.layer, TranscriptStreams.layerAt([])),
      Layer.provideMerge(sync, foundation),
    ),
  )
})

const agentWhere = Effect.fn('agentWhere')(function* (
  machine: MachineId,
  predicate: (row: AgentRow) => boolean,
) {
  const view = yield* herdWhere((herd) =>
    Option.exists(findMachine(herd, machine), (entry) =>
      Option.exists(entry.state, (state) => Arr.some(state.agents, predicate)),
    ),
  )

  return yield* Effect.fromOption(
    findMachine(view, machine).pipe(
      Option.flatMap((entry) => entry.state),
      Option.flatMap((state) => Arr.findFirst(state.agents, predicate)),
    ),
  )
})

const startAgent = Effect.fn('startAgent')(function* (machine: MachineId, first: HerdrScene) {
  const fake = yield* fakeHerdr(first)

  yield* Layer.build(yield* realAgentOver(machine, fake.herdr))

  return fake
})

const working: HerdrScene = { status: 'working', stateChangeSeq: 41, screen: IDLE_SCREEN }

layer(Layer.mergeAll(testHub, BunFileSystem.layer), { excludeTestServices: true })(
  'fake herdr, real agent, real hub, headless phone',
  (live) => {
    live.effect('carries a herdr status change through the agent and the hub to WatchHerd', () =>
      Effect.gen(function* () {
        const machine = MachineId.make('e2e-status')
        const blocked: HerdrScene = {
          status: 'blocked',
          stateChangeSeq: 42,
          screen: yield* screenText(BLOCKED_SCREEN),
        }
        const herdr = yield* startAgent(machine, working)
        const before = yield* agentWhere(machine, (row) => row.pane === PANE)

        yield* herdr.change(blocked)
        const after = yield* agentWhere(machine, (row) => row.status === 'blocked')

        expect([before.status, before.title, before.branch, before.stateChangeSeq]).toEqual([
          'working',
          TITLE,
          Option.some(BRANCH),
          41,
        ])
        expect([after.status, after.stateChangeSeq, Option.isSome(after.ask)]).toEqual([
          'blocked',
          42,
          true,
        ])
      }),
    )

    live.effect('delivers a phone Prompt to herdr as agent.prompt and returns its receipt', () =>
      Effect.gen(function* () {
        const machine = MachineId.make('e2e-prompt')
        const herdr = yield* startAgent(machine, working)

        yield* agentWhere(machine, (row) => row.pane === PANE)
        const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
        const receipt = yield* phone.SendCommand({
          machine,
          key: IdempotencyKey.make('1b7c3f0e-94e2-4e2e-8a7d-2c1f0e9b5a31'),
          command: new Prompt({ pane: PANE, text: 'run the gate again' }),
        })

        expect(receipt).toEqual(
          new InputDelivered({ pane: PANE, terminal: TERMINAL, stateChangeSeq: 41 }),
        )
        expect(yield* herdr.sentMethods('agent.prompt')).toEqual([
          { method: 'agent.prompt', params: { target: PANE, text: 'run the gate again' } },
        ])
      }),
    )

    live.effect('answers the ask the phone reads from WatchHerd with the keys herdr presses', () =>
      Effect.gen(function* () {
        const machine = MachineId.make('e2e-answer')
        const blocked: HerdrScene = {
          status: 'blocked',
          stateChangeSeq: 42,
          screen: yield* screenText(BLOCKED_SCREEN),
        }
        const herdr = yield* startAgent(machine, blocked)
        const row = yield* agentWhere(machine, (agent) => Option.isSome(agent.ask))
        const ask = yield* Effect.fromOption(row.ask)
        const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
        const receipt = yield* phone.SendCommand({
          machine,
          key: IdempotencyKey.make('6a2d9e14-0c3b-4f7a-b1e5-8d4c2a7f9e03'),
          command: new AnswerAsk({ pane: PANE, ask: ask.id, answer: new Approve({}) }),
        })

        expect(receipt).toEqual(
          new InputDelivered({ pane: PANE, terminal: TERMINAL, stateChangeSeq: 42 }),
        )
        expect(yield* herdr.sentMethods('agent.send_keys')).toEqual([
          { method: 'agent.send_keys', params: { target: PANE, keys: ['enter'] } },
        ])
      }),
    )
  },
)
