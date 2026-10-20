import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunSocketServer from '@effect/platform-bun/BunSocketServer'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Socket from 'effect/socket/Socket'
import * as Stream from 'effect/Stream'

import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  HerdrAgentNotFound,
  HerdrConnectionClosed,
  HerdrEventsLost,
  HerdrPaneNotFound,
  HerdrRequestRejected,
  HerdrResponseInvalid,
  type HerdrSubscriptionError,
  HerdrUnreachable,
  scriptedRejection,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import {
  AgentPromptMethod,
  PaneProcessInfoMethod,
  Ping,
  SessionSnapshotMethod,
} from '@crook/herdr/Methods'
import { SessionSnapshot } from '@crook/herdr/Records'

interface ConnectionScript {
  readonly replies: readonly string[]
  readonly keepOpen: boolean
}

const PONG_LINE =
  '{"id":"ping","result":{"type":"pong","version":"0.9.1","protocol":22,"capabilities":{"live_handoff":true}}}'

const SNAPSHOT_LINE = JSON.stringify({
  id: 'session.snapshot',
  result: {
    type: 'session_snapshot',
    snapshot: {
      version: '0.9.1',
      protocol: 22,
      focused_workspace_id: 'w1',
      focused_tab_id: 'w1:t1',
      focused_pane_id: null,
      workspaces: [
        {
          workspace_id: 'w1',
          number: 1,
          label: 'crook',
          focused: true,
          pane_count: 1,
          tab_count: 1,
          active_tab_id: 'w1:t1',
          agent_status: 'working',
        },
      ],
      tabs: [
        {
          tab_id: 'w1:t1',
          workspace_id: 'w1',
          number: 1,
          label: '1 · claude',
          focused: true,
          pane_count: 1,
          agent_status: 'working',
        },
      ],
      panes: [],
      layouts: [],
      agents: [
        {
          pane_id: 'w1:p1',
          terminal_id: 'term_1',
          workspace_id: 'w1',
          tab_id: 'w1:t1',
          focused: true,
          revision: 3,
          agent_status: 'working',
          state_change_seq: 14162,
          agent: 'claude',
          agent_session: {
            agent: 'claude',
            kind: 'id',
            source: 'herdr:claude',
            value: 'session-1',
          },
          cwd: '/home/jliocsar/Projects/crook',
          state_labels: {},
        },
        {
          pane_id: 'w1:p2',
          terminal_id: 'term_2',
          workspace_id: 'w1',
          tab_id: 'w1:t1',
          focused: false,
          revision: 1,
          agent_status: 'unknown',
          agent: 'claude',
        },
      ],
    },
  },
})

const STARTED_LINE = '{"id":"events.subscribe","result":{"type":"subscription_started"}}'

const PANE_CLOSED_LINE =
  '{"data":{"pane_id":"w1:p2","type":"pane_closed","workspace_id":"w1"},"event":"pane_closed"}'

const STATUS_CHANGED_LINE =
  '{"data":{"agent":"claude","agent_status":"blocked","pane_id":"w1:p1","workspace_id":"w1"},"event":"pane.agent_status_changed"}'

const EVENTS_LOST_LINE =
  '{"id":"events.subscribe","error":{"code":"events_lost","message":"subscriber fell behind"}}'

const SentRequest = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, method: Schema.String, params: Schema.Unknown }),
)

const SentSubscription = Schema.fromJsonString(
  Schema.Struct({ params: Schema.Struct({ subscriptions: Schema.Array(Schema.Unknown) }) }),
)

const replyOnce = (...replies: readonly string[]): ConnectionScript => ({
  replies,
  keepOpen: false,
})

const serveScript =
  (script: ConnectionScript, received: Queue.Queue<string>) => (socket: Socket.Socket) =>
    Stream.fromIterable(script.replies).pipe(
      Stream.map((line) => `${line}\n`),
      Stream.concat(script.keepOpen ? Stream.never : Stream.empty),
      Stream.pipeThroughChannel(Socket.toChannelString(socket)),
      Stream.splitLines,
      Stream.runForEach((line) => Queue.offer(received, line)),
      Effect.ignore,
    )

const fakeHerdr = Effect.fn('fakeHerdr')(function* (scripts: readonly ConnectionScript[]) {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped()
  const socketPath = `${directory}/herdr.sock`
  const server = yield* BunSocketServer.make({ path: socketPath })
  const received = yield* Queue.unbounded<string>()
  const connections = yield* Ref.make(0)

  yield* server
    .run((socket) =>
      Ref.getAndUpdate(connections, (count) => count + 1).pipe(
        Effect.flatMap((index) =>
          Option.match(Option.fromNullishOr(scripts[index]), {
            onNone: () => Effect.void,
            onSome: (script) => serveScript(script, received)(socket),
          }),
        ),
      ),
    )
    .pipe(Effect.forkScoped)

  const client = yield* Layer.build(HerdrClient.layerAt(socketPath)).pipe(
    Effect.map((context) => Context.get(context, HerdrClient)),
  )

  return { client, received }
})

layer(BunFileSystem.layer, { excludeTestServices: true })('HerdrClient live', (it) => {
  it.effect('sends one request line and decodes the typed result', () =>
    Effect.gen(function* () {
      const { client, received } = yield* fakeHerdr([replyOnce(PONG_LINE)])
      const pong = yield* client.request(Ping, {})
      const request = yield* Queue.take(received).pipe(
        Effect.flatMap(Schema.decodeEffect(SentRequest)),
      )

      expect(pong).toEqual({ type: 'pong', version: '0.9.1', protocol: 22 })
      expect(request).toEqual({
        id: 'ping',
        method: 'ping',
        params: {},
      })
    }),
  )

  it.effect('decodes a session snapshot, turning absent and null fields into Option', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([replyOnce(SNAPSHOT_LINE)])
      const snapshot = yield* client.snapshot
      const [agent, withoutSeq] = snapshot.agents

      expect(snapshot).toBeInstanceOf(SessionSnapshot)
      expect(snapshot.focused_pane_id).toEqual(Option.none())
      expect(agent?.state_change_seq).toBe(14162)
      expect(withoutSeq?.state_change_seq).toBe(0)
      expect(agent?.title).toEqual(Option.none())
      expect(Option.map(agent?.agent_session ?? Option.none(), (session) => session.value)).toEqual(
        Option.some('session-1'),
      )
    }),
  )

  it.effect('fails with HerdrRequestRejected on an error response', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([
        replyOnce(
          '{"id":"ping","error":{"code":"invalid_request","message":"invalid request: unknown variant"}}',
        ),
      ])
      const error = yield* client.request(Ping, {}).pipe(Effect.flip)

      expect(error).toBeInstanceOf(HerdrRequestRejected)
      expect(error.message).toContain('invalid_request')
    }),
  )

  it.effect('fails with HerdrPaneNotFound when herdr does not know the pane', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([
        replyOnce(
          '{"id":"pane.process_info","error":{"code":"pane_not_found","message":"pane not found"}}',
        ),
      ])
      const error = yield* client
        .request(PaneProcessInfoMethod, { pane_id: 'w9:p9' })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(HerdrPaneNotFound)
      expect(error).toMatchObject({ method: 'pane.process_info' })
    }),
  )

  it.effect('fails with HerdrAgentNotFound when the pane hosts no agent', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([
        replyOnce(
          '{"id":"agent.prompt","error":{"code":"agent_not_found","message":"agent not found"}}',
        ),
      ])
      const error = yield* client
        .request(AgentPromptMethod, { target: 'w1:p2', text: 'continue' })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(HerdrAgentNotFound)
      expect(error).toMatchObject({ method: 'agent.prompt' })
    }),
  )

  it.effect('fails with HerdrResponseInvalid when the result has the wrong shape', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([replyOnce('{"id":"ping","result":{"type":"ok"}}')])
      const error = yield* client.request(Ping, {}).pipe(Effect.flip)

      expect(error).toBeInstanceOf(HerdrResponseInvalid)
    }),
  )

  it.effect('fails with HerdrConnectionClosed when herdr hangs up without answering', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([replyOnce()])
      const error = yield* client.request(Ping, {}).pipe(Effect.flip)

      expect(error).toBeInstanceOf(HerdrConnectionClosed)
    }),
  )

  it.effect('fails with HerdrUnreachable when nothing listens on the socket', () =>
    Effect.gen(function* () {
      const client = yield* Layer.build(HerdrClient.layerAt('/nonexistent/herdr.sock')).pipe(
        Effect.map((context) => Context.get(context, HerdrClient)),
      )
      const error = yield* client.snapshot.pipe(Effect.flip)

      expect(error).toBeInstanceOf(HerdrUnreachable)
      expect(error.message).toContain('/nonexistent/herdr.sock')
    }),
  )

  it.effect('fails with HerdrUnreachable when a crashed herdr left its socket file behind', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped()
      const socketPath = `${directory}/herdr.sock`

      yield* fileSystem.writeFileString(socketPath, '')

      const client = yield* Layer.build(HerdrClient.layerAt(socketPath)).pipe(
        Effect.map((context) => Context.get(context, HerdrClient)),
      )
      const error = yield* client.snapshot.pipe(Effect.flip)

      expect(error).toBeInstanceOf(HerdrUnreachable)
    }),
  )

  it.effect('streams lifecycle and pane-scoped events once the subscription starts', () =>
    Effect.gen(function* () {
      const { client, received } = yield* fakeHerdr([
        { replies: [STARTED_LINE, PANE_CLOSED_LINE, STATUS_CHANGED_LINE], keepOpen: true },
      ])
      const events = yield* client.subscribe([
        { type: 'pane.closed' },
        { type: 'pane.agent_status_changed', pane_id: 'w1:p1' },
      ])
      const collected = yield* events.pipe(Stream.take(2), Stream.runCollect)
      const request = yield* Queue.take(received).pipe(
        Effect.flatMap(Schema.decodeEffect(SentSubscription)),
      )

      expect(collected.map((event) => event.event)).toEqual([
        'pane_closed',
        'pane.agent_status_changed',
      ])
      expect(request.params.subscriptions).toHaveLength(2)
    }),
  )

  it.effect('fails the event stream with HerdrEventsLost when herdr reports an overrun', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([
        replyOnce(STARTED_LINE, PANE_CLOSED_LINE, EVENTS_LOST_LINE),
      ])
      const events = yield* client.subscribe([{ type: 'pane.closed' }])
      const error = yield* events.pipe(Stream.runDrain, Effect.flip)

      expect(error).toBeInstanceOf(HerdrEventsLost)
    }),
  )

  it.effect('fails the event stream with HerdrConnectionClosed when herdr goes away', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([replyOnce(STARTED_LINE)])
      const events = yield* client.subscribe([{ type: 'pane.closed' }])
      const error = yield* events.pipe(Stream.runDrain, Effect.flip)

      expect(error).toBeInstanceOf(HerdrConnectionClosed)
    }),
  )

  it.effect('fails subscribe itself when herdr rejects a subscription entry', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([
        replyOnce(
          '{"id":"events.subscribe","error":{"code":"pane_not_found","message":"pane nope not found"}}',
        ),
      ])
      const error = yield* client
        .subscribe([{ type: 'pane.agent_status_changed', pane_id: 'nope' }])
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(HerdrPaneNotFound)
    }),
  )
})

const scriptedSnapshot = new SessionSnapshot({
  version: '0.9.1',
  protocol: 22,
  focused_workspace_id: Option.none(),
  focused_tab_id: Option.none(),
  focused_pane_id: Option.none(),
  workspaces: [],
  tabs: [],
  panes: [],
  agents: [],
})

const scriptedEvent: HerdrEvent = {
  event: 'pane_closed',
  data: { type: 'pane_closed', pane_id: 'w1:p1', workspace_id: 'w1' },
}

const scriptedEvents = Effect.gen(function* () {
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()

  yield* Queue.offer(events, scriptedEvent)
  yield* Queue.fail(events, new HerdrEventsLost())

  return events
})

const testLayer = Layer.unwrap(
  Effect.map(scriptedEvents, (events) =>
    HerdrClient.layerTest({
      responses: [
        scriptedResult(SessionSnapshotMethod, {
          type: 'session_snapshot',
          snapshot: scriptedSnapshot,
        }),
        scriptedRejection(Ping, 'server_busy', 'try again'),
      ],
      events,
    }),
  ),
)

layer(testLayer)('HerdrClient.layerTest', (it) => {
  it.effect('answers scripted methods through the same decoder as the live client', () =>
    Effect.gen(function* () {
      const client = yield* HerdrClient
      const snapshot = yield* client.snapshot
      const rejection = yield* client.request(Ping, {}).pipe(Effect.flip)

      expect(snapshot).toEqual(scriptedSnapshot)
      expect(rejection).toBeInstanceOf(HerdrRequestRejected)
    }),
  )

  it.effect('replays the scripted event queue, failure included', () =>
    Effect.gen(function* () {
      const client = yield* HerdrClient
      const events = yield* client.subscribe([{ type: 'pane.closed' }])
      const first = yield* events.pipe(Stream.take(1), Stream.runCollect)

      expect(first).toEqual([scriptedEvent])
    }),
  )
})
