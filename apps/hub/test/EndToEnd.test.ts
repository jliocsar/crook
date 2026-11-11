import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import * as AgentDaemon from '@crook/agent/AgentDaemon'
import { CheckoutHeads } from '@crook/agent/CheckoutHeads'
import { ClaudeSessionFiles } from '@crook/agent/ClaudeSessionFiles'
import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { HookInbox } from '@crook/agent/HookInbox'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { PaneScreens } from '@crook/agent/PaneScreens'
import { PendingAsks } from '@crook/agent/PendingAsks'
import { RecentPlaces } from '@crook/agent/RecentPlaces'
import { RunningSubagents } from '@crook/agent/RunningSubagents'
import { emptyHookLedger } from '@crook/claude/HookLedger'
import { LastTurn } from '@crook/claude/LastTurn'
import { spikeScreen } from '@crook/claude/fixtures/SpikeScreens.ts'
import type { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { PermissionAsk, RunCommand } from '@crook/domain/Ask'
import { AnswerAsk, Approve, InputDelivered, Prompt } from '@crook/domain/Command'
import { HerdReplaced, type HerdUpdate, MachineReplaced } from '@crook/domain/HerdUpdate'
import { type HerdMachine, findMachine } from '@crook/domain/HerdView'
import { IdempotencyKey, MachineId, TerminalId } from '@crook/domain/Ids'
import { isHerdrLost } from '@crook/domain/MachineState'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type ScriptedResponse,
  type SentRequest,
  decodeSentRequest,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import {
  AgentPromptMethod,
  AgentSendKeysMethod,
  PaneReadMethod,
  SessionSnapshotMethod,
} from '@crook/herdr/Methods'
import { agentInfo, paneInfo, sessionSnapshot } from '@crook/herdr/fixtures/Records.ts'
import { ClientApi } from '@crook/protocol/ClientApi'
import { CLIENT_PATH } from '@crook/protocol/HubRoutes'

import {
  PANE,
  agentOver,
  connect,
  discardingAgentAudit,
  herdWhere,
  ownerLogin,
  testHub,
} from './Fixtures'

interface HerdrScene {
  readonly status: AgentStatus
  readonly stateChangeSeq: number
  readonly screen: string
}

const TERMINAL = TerminalId.make('term_65e4981ac9ff02')
const CWD = '/home/jliocsar/Projects/crook-worktrees/e2e'
const BRANCH = 'feat/jc-94-e2e'
const TITLE = 'JC-94 End-to-end check'
const BLOCKED_SCREEN = '12-native-bash-t20'
const BLOCKED_COMMAND = 'echo probe-bash-native > bash-native.txt'
const IDLE_SCREEN = ''

const snapshotOf = (scene: HerdrScene) =>
  sessionSnapshot(
    [
      agentInfo({
        pane_id: PANE,
        terminal_id: TERMINAL,
        agent_status: scene.status,
        state_change_seq: scene.stateChangeSeq,
        terminal_title: Option.some(`✳ ${TITLE}`),
        terminal_title_stripped: Option.some(TITLE),
        cwd: Option.some(CWD),
      }),
    ],
    [
      paneInfo({
        pane_id: PANE,
        terminal_id: TERMINAL,
        agent_status: scene.status,
        agent: Option.some('claude'),
        display_agent: Option.some('claude'),
        cwd: Option.some(CWD),
      }),
    ],
  )

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
    workspace_id: 'w1',
    agent_status: status,
    agent: Option.some('claude'),
    display_agent: Option.none(),
    title: Option.none(),
  },
})

const fakeHerdr = Effect.fn('fakeHerdr')(function* (first: HerdrScene) {
  const sent = yield* Queue.unbounded<SentRequest>()
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const herdr = yield* HerdrClient.makeSwitchingTest({ responses: scriptFor(first), events, sent })
  const change = (scene: HerdrScene) =>
    herdr
      .respondWith(scriptFor(scene))
      .pipe(Effect.andThen(Queue.offer(events, statusChanged(scene.status))))
  const sentMethods = (method: string) =>
    Effect.map(Queue.clear(sent), (requests) =>
      requests.map(decodeSentRequest).filter((request) => request.method === method),
    )

  return { herdr: herdr.layer, change, sentMethods }
})

const syncingFoundation = Effect.fn('syncingFoundation')(function* (
  machine: MachineId,
  herdr: Layer.Layer<HerdrClient>,
) {
  const ledger = yield* SubscriptionRef.make(emptyHookLedger)
  const host = Layer.mergeAll(
    herdr,
    ClaudeSessionFiles.layerTest(),
    CreatedPanes.layerTest(),
    GitBranches.layerTest(new Map([[CWD, BRANCH]])),
    discardingAgentAudit,
    BunFileSystem.layer,
    Path.layer,
    ConfigProvider.layer(ConfigProvider.fromUnknown({ CROOK_MACHINE_ID: machine })),
  )
  const transcriptReaders = AgentDaemon.transcriptReadersAt([])
  const pendingAsks = Layer.provide(PendingAsks.layer, [
    HookInbox.layerTest(ledger),
    transcriptReaders,
    LastTurn.layer,
    PaneScreens.layer,
  ])
  const runningSubagents = Layer.provide(RunningSubagents.layer, transcriptReaders)
  const sync = Layer.provide(MachineStateSync.layer, [
    pendingAsks,
    ClaudeSessions.layerTest(new Map()),
    CheckoutHeads.layerTest(),
    RecentPlaces.layerTest(),
    runningSubagents,
  ])

  return Layer.provideMerge(sync, host)
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

  yield* Layer.build(yield* agentOver(machine, yield* syncingFoundation(machine, fake.herdr), []))

  return fake
})

const working: HerdrScene = { status: 'working', stateChangeSeq: 41, screen: IDLE_SCREEN }

const entriesIn = (update: HerdUpdate): readonly HerdMachine[] =>
  Match.value(update).pipe(
    Match.tagsExhaustive({
      HerdReplaced: (replaced) => replaced.herd.machines,
      MachineReplaced: (replaced) => [replaced.entry],
      MachineLeft: () => [],
    }),
  )

const machinesTouched = (update: HerdUpdate): readonly MachineId[] =>
  Match.value(update).pipe(
    Match.tag('MachineLeft', (left) => [left.machine]),
    Match.orElse((other) => entriesIn(other).map((entry) => entry.machine.id)),
  )

const showsBlocked = (machine: MachineId) => (update: HerdUpdate) =>
  Arr.some(
    entriesIn(update),
    (entry) =>
      entry.machine.id === machine &&
      Option.exists(entry.state, (state) =>
        Arr.some(state.agents, (row) => row.status === 'blocked'),
      ),
  )

const commandAsked = (row: AgentRow) =>
  row.ask.pipe(
    Option.filter(Schema.is(PermissionAsk)),
    Option.map((ask) => [ask.tool, ask.action]),
  )

layer(Layer.mergeAll(testHub, BunFileSystem.layer), { excludeTestServices: true })(
  'fake herdr, real agent, real hub, headless phone',
  (live) => {
    live.effect('shows an agent started before herdr as online with herdr lost', () =>
      Effect.gen(function* () {
        const machine = MachineId.make('e2e-before-herdr')
        const fileSystem = yield* FileSystem.FileSystem
        const folder = yield* fileSystem.makeTempDirectoryScoped()
        const herdr = HerdrClient.layerAt(`${folder}/herdr.sock`)

        yield* Layer.build(yield* agentOver(machine, yield* syncingFoundation(machine, herdr), []))

        const view = yield* herdWhere((herd) =>
          Option.exists(
            findMachine(herd, machine),
            (entry) =>
              entry.machine.connection === 'online' && Option.exists(entry.state, isHerdrLost),
          ),
        )

        expect(
          Option.flatMap(findMachine(view, machine), (entry) => entry.state).pipe(
            Option.map((state) => state.agents),
          ),
        ).toEqual(Option.some([]))
      }),
    )

    live.effect('carries a herdr status change through the agent and the hub to WatchHerd', () =>
      Effect.gen(function* () {
        const machine = MachineId.make('e2e-status')
        const blocked: HerdrScene = {
          status: 'blocked',
          stateChangeSeq: 42,
          screen: yield* spikeScreen(BLOCKED_SCREEN),
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
        expect([after.status, after.stateChangeSeq, commandAsked(after)]).toEqual([
          'blocked',
          42,
          Option.some(['Bash', new RunCommand({ command: BLOCKED_COMMAND })]),
        ])
      }),
    )

    live.effect('sends the phone only the machine whose herdr changed, not the whole herd', () =>
      Effect.gen(function* () {
        const changing = MachineId.make('e2e-changing')
        const quiet = MachineId.make('e2e-quiet')
        const blocked: HerdrScene = {
          status: 'blocked',
          stateChangeSeq: 42,
          screen: yield* spikeScreen(BLOCKED_SCREEN),
        }
        const herdr = yield* startAgent(changing, working)

        yield* startAgent(quiet, working)
        yield* agentWhere(changing, (row) => row.pane === PANE)
        yield* agentWhere(quiet, (row) => row.pane === PANE)
        const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
        const updates = yield* Queue.unbounded<HerdUpdate>()

        yield* phone.WatchHerd().pipe(
          Stream.runForEach((update) => Queue.offer(updates, update)),
          Effect.forkScoped,
        )
        const opening = yield* Queue.take(updates)
        yield* herdr.change(blocked)
        const sinceOpening = yield* Stream.fromQueue(updates).pipe(
          Stream.takeUntil(showsBlocked(changing)),
          Stream.runCollect,
        )

        expect(opening).toBeInstanceOf(HerdReplaced)
        expect(machinesTouched(opening)).toEqual(expect.arrayContaining([changing, quiet]))
        expect(sinceOpening.filter(Schema.is(HerdReplaced))).toEqual([])
        expect(sinceOpening.flatMap(machinesTouched)).not.toContain(quiet)
        expect(
          Arr.last(sinceOpening).pipe(
            Option.map((update) => [Schema.is(MachineReplaced)(update), machinesTouched(update)]),
          ),
        ).toEqual(Option.some([true, [changing]]))
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
          command: new Prompt({ pane: PANE, text: 'run the gate again', attachments: [] }),
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
          screen: yield* spikeScreen(BLOCKED_SCREEN),
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
