import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer'
import * as BunSocket from '@effect/platform-bun/BunSocket'
import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import * as RpcClient from 'effect/rpc/RpcClient'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import type * as Rpc from 'effect/rpc/Rpc'

import { CommandExecutor } from '@crook/agent/CommandExecutor'
import * as HubLink from '@crook/agent/HubLink'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { AgentRow } from '@crook/domain/AgentRow'
import type { HerdView } from '@crook/domain/HerdView'
import {
  ClaudeSessionId,
  MachineId,
  PaneId,
  TabId,
  TranscriptOffset,
  WorkspaceId,
} from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { PaneTranscript, type TranscriptEvent, TranscriptPosition } from '@crook/domain/Transcript'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type SentRequest,
} from '@crook/herdr/HerdrClient'
import * as Database from '@crook/hub/Database'
import * as HttpRoutes from '@crook/hub/HttpRoutes'
import { AGENT_PING_INTERVAL, AgentLink, Hello } from '@crook/protocol/AgentLink'
import { ClientApi, MachineNotInHerd, PaneNotInHerd } from '@crook/protocol/ClientApi'
import { protocolSerialization } from '@crook/protocol/Serialization'

const OWNER = 'owner@example.com'
const HUB_ORIGIN = 'https://my-hub.exe.xyz'
const IN_MEMORY = ':memory:'
const PROJECT = '-home-jliocsar-Projects-crook'
const PANE = PaneId.make('w1:p1')
const CLOSED_PANE = PaneId.make('w1:p9')
const FIRST_SESSION = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
const CLEARED_SESSION = ClaudeSessionId.make('5b1e7c2a-8d34-4f6e-9a0b-c7d2e1f3a4b5')

const hello = new Hello({ agentVersion: '0.0.9', label: Option.none() })

const ownerLogin = { 'X-ExeDev-Email': OWNER, Origin: HUB_ORIGIN }

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const agentToken = (machine: MachineId) => ({
  'X-ExeDev-Email': OWNER,
  'X-ExeDev-Token-Ctx': encodeJson({ machine }),
})

const testServer = BunHttpServer.layer({
  hostname: '127.0.0.1',
  port: 0,
  gracefulShutdownTimeout: Duration.zero,
  websocket: HttpRoutes.socketOptions,
})

const testConfig = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    CROOK_OWNER_EMAIL: OWNER,
    CROOK_HUB_ORIGIN: HUB_ORIGIN,
    CROOK_WEB_ROOT: `${import.meta.dirname}/web`,
  }),
)

const servedHub = HttpRouter.serve(HttpRoutes.layer, { disableLogger: true }).pipe(
  Layer.provideMerge(testServer),
)

const testHub = Layer.provide(servedHub, [testConfig, Database.layerAt(IN_MEMORY)])

const userLine = (text: string) =>
  `${encodeJson({
    type: 'user',
    uuid: `user-${text}`,
    timestamp: '2026-10-20T17:52:35.958Z',
    message: { role: 'user', content: text },
  })}\n`

const bytesOf = (text: string) => new TextEncoder().encode(text).byteLength

const describeEvent = (event: TranscriptEvent) =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: (opened) => `opened ${opened.session}`,
      TranscriptChunk: (chunk) =>
        `chunk ${chunk.session} ${chunk.offset}-${chunk.nextOffset} ${chunk.messages.length}`,
      SubagentsChanged: (changed) => `subagents ${changed.session} ${changed.subagents.length}`,
    }),
  )

const stateOn = (machine: MachineId, version: number, session: ClaudeSessionId) =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(version),
    herdrVersion: '0.9.1',
    workspaces: [],
    tabs: [],
    agents: [
      new AgentRow({
        pane: PANE,
        workspace: WorkspaceId.make('w1'),
        tab: TabId.make('w1:t1'),
        status: 'working',
        title: 'EX-253 Example feature',
        cwd: '/home/jliocsar/Projects/crook',
        branch: Option.none(),
        claudeSession: Option.some(session),
        stateChangeSeq: 4,
        statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
      }),
    ],
  })

const connect = Effect.fn('connect')(function* <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  path: string,
  headers: Record<string, string>,
) {
  const url = yield* HttpServer.addressFormattedWith((address) =>
    Effect.succeed(`${address.replace(/^http/u, 'ws')}${path}`),
  )
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolSocket({
      pingInterval: AGENT_PING_INTERVAL,
      retryPolicy: Schedule.recurs(0),
    }).pipe(Layer.provide([BunSocket.layerWebSocket(url, { headers }), protocolSerialization])),
  )

  return yield* RpcClient.make(group).pipe(Effect.provide(protocol))
})

const herdWhere = Effect.fn('herdWhere')(function* (predicate: (view: HerdView) => boolean) {
  const phone = yield* connect(ClientApi, HttpRoutes.CLIENT_PATH, ownerLogin)

  return yield* phone
    .WatchHerd()
    .pipe(Stream.filter(predicate), Stream.runHead, Effect.flatMap(Effect.fromOption))
}, Effect.scoped)

const machineOnline = (machine: MachineId) =>
  herdWhere((view) =>
    Arr.some(
      view.machines,
      (entry) => entry.machine.id === machine && entry.machine.connection === 'online',
    ),
  )

const claudeRoot = Effect.fn('claudeRoot')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()

  yield* fileSystem.makeDirectory(`${root}/projects/${PROJECT}`, { recursive: true })

  return root
})

const append = Effect.fn('append')(function* (
  root: string,
  session: ClaudeSessionId,
  text: string,
) {
  const fileSystem = yield* FileSystem.FileSystem

  yield* fileSystem.writeFileString(`${root}/projects/${PROJECT}/${session}.jsonl`, text, {
    flag: 'a',
  })
})

const startAgent = Effect.fn('startAgent')(function* (
  machine: MachineId,
  root: string,
  state: SubscriptionRef.SubscriptionRef<MachineState>,
) {
  const server = yield* HttpServer.HttpServer
  const scope = yield* Scope.fork(yield* Effect.scope)
  const herdr = HerdrClient.layerTest({
    responses: [],
    events: yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>(),
    sent: yield* Queue.unbounded<SentRequest>(),
  })
  const dialHub = connect(AgentLink, HttpRoutes.AGENT_PATH, agentToken(machine)).pipe(
    Effect.provideService(HttpServer.HttpServer, server),
  )

  yield* Layer.buildWithScope(
    Layer.provide(
      HubLink.layerWith(dialHub, hello),
      Layer.provideMerge(Layer.mergeAll(CommandExecutor.layer, TranscriptStreams.layerAt([root])), [
        MachineStateSync.layerTest(state),
        herdr,
        BunFileSystem.layer,
      ]),
    ),
    scope,
  )
  yield* machineOnline(machine)

  return scope
})

const watchOnPhone = Effect.fn('watchOnPhone')(function* (
  machine: MachineId,
  from: Option.Option<TranscriptPosition>,
) {
  const phone = yield* connect(ClientApi, HttpRoutes.CLIENT_PATH, ownerLogin)
  const events = yield* Queue.unbounded<string>()

  yield* phone.WatchTranscript({ machine, source: new PaneTranscript({ pane: PANE }), from }).pipe(
    Stream.runForEach((event) => Queue.offer(events, describeEvent(event))),
    Effect.ignore,
    Effect.forkScoped,
  )

  return events
})

const takeAll = (events: Queue.Queue<string>, count: number) =>
  Effect.forEach(
    Arr.makeBy(count, () => events),
    Queue.take,
  )

layer(testHub, { excludeTestServices: true })('Transcripts through HttpRoutes', (live) => {
  live.effect('streams a pane transcript from the real agent to the phone, across /clear', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('transcript-laptop')
      const root = yield* claudeRoot()
      const first = userLine('first')
      const second = userLine('second')
      const cleared = userLine('cleared')

      yield* append(root, FIRST_SESSION, first)
      yield* append(root, CLEARED_SESSION, cleared)

      const state = yield* SubscriptionRef.make(stateOn(machine, 1, FIRST_SESSION))

      yield* startAgent(machine, root, state)
      const events = yield* watchOnPhone(machine, Option.none())

      expect(yield* takeAll(events, 2)).toEqual([
        `opened ${FIRST_SESSION}`,
        `chunk ${FIRST_SESSION} 0-${bytesOf(first)} 1`,
      ])

      yield* append(root, FIRST_SESSION, second)

      expect(yield* Queue.take(events)).toBe(
        `chunk ${FIRST_SESSION} ${bytesOf(first)}-${bytesOf(first + second)} 1`,
      )

      yield* SubscriptionRef.set(state, stateOn(machine, 2, CLEARED_SESSION))

      expect(yield* takeAll(events, 2)).toEqual([
        `opened ${CLEARED_SESSION}`,
        `chunk ${CLEARED_SESSION} 0-${bytesOf(cleared)} 1`,
      ])
    }),
  )

  live.effect('resumes a phone from its byte offset, finishing the session it was reading', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('transcript-resume')
      const root = yield* claudeRoot()
      const seen = userLine('seen')
      const missed = userLine('missed')
      const cleared = userLine('cleared')

      yield* append(root, FIRST_SESSION, seen + missed)
      yield* append(root, CLEARED_SESSION, cleared)

      const state = yield* SubscriptionRef.make(stateOn(machine, 1, CLEARED_SESSION))

      yield* startAgent(machine, root, state)
      const events = yield* watchOnPhone(
        machine,
        Option.some(
          new TranscriptPosition({
            session: FIRST_SESSION,
            offset: TranscriptOffset.make(bytesOf(seen)),
          }),
        ),
      )

      expect(yield* takeAll(events, 3)).toEqual([
        `chunk ${FIRST_SESSION} ${bytesOf(seen)}-${bytesOf(seen + missed)} 1`,
        `opened ${CLEARED_SESSION}`,
        `chunk ${CLEARED_SESSION} 0-${bytesOf(cleared)} 1`,
      ])
    }),
  )

  live.effect('keeps the phone stream across an agent reconnect, without repeating a line', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('transcript-reconnect')
      const root = yield* claudeRoot()
      const before = userLine('before')
      const during = userLine('during')

      yield* append(root, FIRST_SESSION, before)

      const state = yield* SubscriptionRef.make(stateOn(machine, 1, FIRST_SESSION))
      const agent = yield* startAgent(machine, root, state)
      const events = yield* watchOnPhone(machine, Option.none())

      expect(yield* takeAll(events, 2)).toEqual([
        `opened ${FIRST_SESSION}`,
        `chunk ${FIRST_SESSION} 0-${bytesOf(before)} 1`,
      ])

      yield* Scope.close(agent, Exit.void)
      yield* append(root, FIRST_SESSION, during)
      yield* startAgent(machine, root, state)

      expect(yield* Queue.take(events)).toBe(
        `chunk ${FIRST_SESSION} ${bytesOf(before)}-${bytesOf(before + during)} 1`,
      )
    }),
  )

  live.effect('refuses a transcript for a machine or a pane the herd does not have', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('transcript-refusals')
      const root = yield* claudeRoot()
      const nowhere = MachineId.make('transcript-nowhere')
      const state = yield* SubscriptionRef.make(stateOn(machine, 1, FIRST_SESSION))

      yield* startAgent(machine, root, state)
      const phone = yield* connect(ClientApi, HttpRoutes.CLIENT_PATH, ownerLogin)
      const watchFirst = (watched: MachineId, pane: PaneId) =>
        phone
          .WatchTranscript({
            machine: watched,
            source: new PaneTranscript({ pane }),
            from: Option.none(),
          })
          .pipe(Stream.runHead, Effect.flip)

      expect(yield* watchFirst(nowhere, PANE)).toEqual(new MachineNotInHerd({ machine: nowhere }))
      expect(yield* watchFirst(machine, CLOSED_PANE)).toEqual(
        new PaneNotInHerd({ machine, pane: CLOSED_PANE }),
      )
    }),
  )
})
