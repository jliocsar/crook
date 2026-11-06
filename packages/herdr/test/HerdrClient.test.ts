import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunSocketServer from '@effect/platform-bun/BunSocketServer'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Latch from 'effect/Latch'
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
  HerdrPaneBusy,
  HerdrPaneNotFound,
  HerdrPromptStalled,
  HerdrRequestRejected,
  HerdrResponseInvalid,
  type HerdrSubscriptionError,
  HerdrTimedOut,
  HerdrUnreachable,
  scriptedRejection,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import {
  AgentPromptMethod,
  AgentStartMethod,
  AgentWaitMethod,
  EventsSubscribeMethod,
  HERDR_READ_TIMEOUT,
  PaneCloseMethod,
  PaneProcessInfoMethod,
  PaneRenameMethod,
  PaneSendInputMethod,
  PaneWaitForOutputMethod,
  Ping,
  SessionSnapshotMethod,
  WorktreeCreateMethod,
} from '@crook/herdr/Methods'
import { sessionSnapshot } from '@crook/herdr/fixtures/Records.ts'
import { SessionSnapshot } from '@crook/herdr/Records'

interface ConnectionScript {
  readonly replies: readonly string[]
  readonly keepOpen: boolean
}

const HERDR_NOTICED_HANG_UP = Duration.millis(125)

const PONG_LINE =
  '{"id":"ping","result":{"type":"pong","version":"0.9.1","protocol":22,"capabilities":{"live_handoff":true}}}'

const PANE_RENAME_REPLY_LINE =
  '{"id":"pane.rename","result":{"type":"pane_info","pane":{"pane_id":"w1:p1","terminal_id":"term_65e4b2b37ae2a1","workspace_id":"w1","tab_id":"w1:t1","focused":true,"label":"Renamed by crook","agent":"claude","agent_status":"idle","revision":3}}}'

const PANE_CLOSE_REPLY_LINE = '{"id":"pane.close","result":{"type":"ok"}}'

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

const WORKTREE_CREATED_LINE =
  '{"id":"worktree.create","result":{"type":"worktree_created","workspace":{"workspace_id":"w3","number":3,"label":"probe wt","focused":false,"pane_count":1,"tab_count":1,"active_tab_id":"w3:t1","agent_status":"unknown","worktree":{"repo_key":"/home/jliocsar/probe/repo/.git","repo_name":"repo","repo_root":"/home/jliocsar/probe/repo","checkout_path":"/home/jliocsar/probe/wt","is_linked_worktree":true}},"tab":{"tab_id":"w3:t1","workspace_id":"w3","number":1,"label":"1","focused":false,"pane_count":1,"agent_status":"unknown"},"root_pane":{"pane_id":"w3:p1","terminal_id":"term_65e59abce88da6","workspace_id":"w3","tab_id":"w3:t1","focused":false,"cwd":"/home/jliocsar/probe/wt","foreground_cwd":"/home/jliocsar/probe/wt","agent_status":"unknown","scroll":{"offset_from_bottom":0,"max_offset_from_bottom":0,"viewport_rows":40},"revision":0},"worktree":{"path":"/home/jliocsar/probe/wt","branch":"probe/wt","is_bare":false,"is_detached":false,"is_prunable":false,"is_linked_worktree":true,"open_workspace_id":"w3","label":"repo"}}}'

const AGENT_STARTED_LINE =
  '{"id":"agent.start","result":{"type":"agent_started","agent":{"terminal_id":"term_65e59abc3b76a2","name":"crook-1","agent_status":"unknown","workspace_id":"w1","tab_id":"w1:t2","pane_id":"w1:p2","focused":false,"launch_pending":true,"state_change_seq":0,"cwd":"/home/jliocsar/probe/repo","foreground_cwd":"/home/jliocsar/probe/repo","revision":0},"argv":["claude"]}}'

const PANE_BUSY_LINE =
  '{"id":"agent.start","error":{"code":"agent_pane_busy","message":"agent target pane w1:p2 is not an available shell"}}'

const PROMPT_STALLED_LINE =
  '{"id":"agent.prompt","error":{"code":"agent_prompt_stalled","message":"agent w1:p2 did not start working"}}'

const INPUT_SENT_LINE = '{"id":"pane.send_input","result":{"type":"ok"}}'
const STARTED_LINE = '{"id":"events.subscribe","result":{"type":"subscription_started"}}'

const SUBSCRIBE_REQUEST_LINE =
  '{"id":"events.subscribe","method":"events.subscribe","params":{"subscriptions":[{"type":"pane.closed"},{"type":"pane.agent_status_changed","pane_id":"w1:p1"}]}}'

const PANE_CLOSED_LINE =
  '{"data":{"pane_id":"w1:p2","type":"pane_closed","workspace_id":"w1"},"event":"pane_closed"}'

const STATUS_CHANGED_LINE =
  '{"data":{"agent":"claude","agent_status":"blocked","pane_id":"w1:p1","workspace_id":"w1"},"event":"pane.agent_status_changed"}'

const UNKNOWN_EVENT_LINE = '{"event":"pane_teleported","data":{"pane_id":42}}'

const CHANGED_EVENT_LINE =
  '{"event":"pane_updated","data":{"pane":{"pane_id":null,"revision":"x"}}}'

const EVENTS_LOST_LINE =
  '{"id":"events.subscribe","error":{"code":"events_lost","message":"subscriber fell behind"}}'

const SentRequest = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, method: Schema.String, params: Schema.Unknown }),
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
      Effect.ignore({ log: 'Debug' }),
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

const heldReply = Effect.fn('heldReply')(function* (reply: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped()
  const socketPath = `${directory}/herdr.sock`
  const server = yield* BunSocketServer.make({ path: socketPath })
  const received = yield* Queue.unbounded<string>()
  const clientHungUp = yield* Deferred.make<void>()
  const answer = yield* Latch.make(false)

  yield* server
    .run((socket) =>
      Stream.fromEffect(Effect.as(answer.await, `${reply}\n`)).pipe(
        Stream.concat(Stream.never),
        Stream.pipeThroughChannel(Socket.toChannelString(socket)),
        Stream.splitLines,
        Stream.runForEach((line) => Queue.offer(received, line)),
        Effect.andThen(Deferred.succeed(clientHungUp, undefined)),
        Effect.ignore({ log: 'Debug' }),
      ),
    )
    .pipe(Effect.forkScoped)

  const client = yield* Layer.build(HerdrClient.layerAt(socketPath)).pipe(
    Effect.map((context) => Context.get(context, HerdrClient)),
  )

  return { client, received, clientHungUp, answer }
})

layer(BunFileSystem.layer, { excludeTestServices: true })('HerdrClient live', (it) => {
  it.effect('keeps the connection open until herdr answers a slow request', () =>
    Effect.gen(function* () {
      const { client, received, clientHungUp, answer } = yield* heldReply(PONG_LINE)
      const pong = yield* client.request(Ping, {}).pipe(Effect.forkScoped)

      yield* Queue.take(received)
      const hungUp = yield* Deferred.await(clientHungUp).pipe(
        Effect.timeoutOption(HERDR_NOTICED_HANG_UP),
      )

      yield* answer.open

      expect(hungUp).toEqual(Option.none())
      expect(yield* Fiber.join(pong)).toEqual({ type: 'pong', version: '0.9.1', protocol: 22 })
    }),
  )

  it.effect('names a read herdr never answers as a timeout, instead of waiting for good', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([{ replies: [], keepOpen: true }])
      const error = yield* client.request(Ping, {}).pipe(Effect.flip)

      expect(error).toEqual(
        new HerdrTimedOut({
          method: Ping.name,
          timeoutMillis: Duration.toMillis(HERDR_READ_TIMEOUT),
        }),
      )
    }),
  )

  it.effect('names a subscribe herdr never starts as a timeout', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([{ replies: [], keepOpen: true }])
      const error = yield* client
        .subscribe([{ type: 'pane.closed' }])
        .pipe(Effect.flip, Effect.scoped)

      expect(error).toEqual(
        new HerdrTimedOut({
          method: EventsSubscribeMethod.name,
          timeoutMillis: Duration.toMillis(HERDR_READ_TIMEOUT),
        }),
      )
    }),
  )

  it.effect(
    'leaves the calls that legitimately wait to the budget of the command around them',
    () =>
      Effect.sync(() => {
        expect(
          [
            Option.isNone(AgentPromptMethod.replyTimeout),
            Option.isNone(AgentStartMethod.replyTimeout),
            Option.isNone(AgentWaitMethod.replyTimeout),
            Option.isNone(PaneWaitForOutputMethod.replyTimeout),
            Option.isNone(WorktreeCreateMethod.replyTimeout),
          ].every(Boolean),
        ).toBe(true)
      }),
  )

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

  it.effect('renames a pane with a label, clears one with null, and closes a pane', () =>
    Effect.gen(function* () {
      const { client, received } = yield* fakeHerdr([
        replyOnce(PANE_RENAME_REPLY_LINE),
        replyOnce(PANE_RENAME_REPLY_LINE),
        replyOnce(PANE_CLOSE_REPLY_LINE),
      ])
      const renamed = yield* client.request(PaneRenameMethod, {
        pane_id: 'w1:p1',
        label: 'Renamed by crook',
      })

      yield* client.request(PaneRenameMethod, { pane_id: 'w1:p1', label: null })
      const closed = yield* client.request(PaneCloseMethod, { pane_id: 'w1:p1' })
      const requests = yield* Effect.forEach([1, 2, 3], () =>
        Queue.take(received).pipe(Effect.flatMap(Schema.decodeEffect(SentRequest))),
      )

      expect(renamed.type).toBe('pane_info')
      expect(renamed.pane.pane_id).toBe('w1:p1')
      expect(renamed.pane.label).toEqual(Option.some('Renamed by crook'))
      expect(closed).toEqual({ type: 'ok' })
      expect(requests.map((request) => request.params)).toEqual([
        { pane_id: 'w1:p1', label: 'Renamed by crook' },
        { pane_id: 'w1:p1', label: null },
        { pane_id: 'w1:p1' },
      ])
    }),
  )

  it.effect(
    'creates a worktree and starts claude in a pane, decoding what herdr 0.9.5 answered',
    () =>
      Effect.gen(function* () {
        const { client, received } = yield* fakeHerdr([
          replyOnce(WORKTREE_CREATED_LINE),
          replyOnce(AGENT_STARTED_LINE),
        ])
        const created = yield* client.request(WorktreeCreateMethod, {
          cwd: '/home/jliocsar/probe/repo',
          branch: 'probe/wt',
          path: '/home/jliocsar/probe/wt',
        })
        const started = yield* client.request(AgentStartMethod, {
          name: 'crook-1',
          kind: 'claude',
          pane_id: 'w1:p2',
        })
        const requests = yield* Effect.forEach([1, 2], () =>
          Queue.take(received).pipe(Effect.flatMap(Schema.decodeEffect(SentRequest))),
        )

        expect(created.root_pane.pane_id).toBe('w3:p1')
        expect(created.worktree.path).toBe('/home/jliocsar/probe/wt')
        expect(created.worktree.branch).toEqual(Option.some('probe/wt'))
        expect(
          Option.map(created.workspace.worktree, (worktree) => worktree.checkout_path),
        ).toEqual(Option.some('/home/jliocsar/probe/wt'))
        expect(started.agent.agent_status).toBe('unknown')
        expect(started.argv).toEqual(['claude'])
        expect(requests.map((request) => request.params)).toEqual([
          { cwd: '/home/jliocsar/probe/repo', branch: 'probe/wt', path: '/home/jliocsar/probe/wt' },
          { name: 'crook-1', kind: 'claude', pane_id: 'w1:p2' },
        ])
      }),
  )

  it.effect('fails with HerdrPaneBusy when the pane is not at a shell yet', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([replyOnce(PANE_BUSY_LINE)])
      const busy = yield* client
        .request(AgentStartMethod, { name: 'crook-1', kind: 'claude', pane_id: 'w1:p2' })
        .pipe(Effect.flip)

      expect(busy).toEqual(
        new HerdrPaneBusy({
          method: 'agent.start',
          detail: 'agent target pane w1:p2 is not an available shell',
        }),
      )
    }),
  )

  it.effect('fails with HerdrPromptStalled when the agent did not start working on a prompt', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([replyOnce(PROMPT_STALLED_LINE)])
      const stalled = yield* client
        .request(AgentPromptMethod, { target: 'w1:p2', text: 'go', wait: { until: ['working'] } })
        .pipe(Effect.flip)

      expect(stalled).toEqual(
        new HerdrPromptStalled({
          method: 'agent.prompt',
          detail: 'agent w1:p2 did not start working',
        }),
      )
    }),
  )

  it.effect('types into a pane with pane.send_input', () =>
    Effect.gen(function* () {
      const { client, received } = yield* fakeHerdr([replyOnce(INPUT_SENT_LINE)])
      const sent = yield* client.request(PaneSendInputMethod, {
        pane_id: 'w1:p2',
        text: ' unset CLAUDECODE',
        keys: ['enter'],
      })
      const request = yield* Queue.take(received).pipe(
        Effect.flatMap(Schema.decodeEffect(SentRequest)),
      )

      expect(sent).toEqual({ type: 'ok' })
      expect(request.params).toEqual({
        pane_id: 'w1:p2',
        text: ' unset CLAUDECODE',
        keys: ['enter'],
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
      const request = yield* Queue.take(received)

      expect(collected.map((event) => event.event)).toEqual([
        'pane_closed',
        'pane.agent_status_changed',
      ])
      expect(request).toBe(SUBSCRIBE_REQUEST_LINE)
    }),
  )

  it.effect('keeps the subscription through an event it has never seen, or one that changed', () =>
    Effect.gen(function* () {
      const { client } = yield* fakeHerdr([
        replyOnce(STARTED_LINE, UNKNOWN_EVENT_LINE, CHANGED_EVENT_LINE, PANE_CLOSED_LINE),
      ])
      const events = yield* client.subscribe([{ type: 'pane.closed' }])
      const collected = yield* events.pipe(Stream.take(3), Stream.runCollect)

      expect(collected.map((event) => event.event)).toEqual([
        'pane_teleported',
        'pane_updated',
        'pane_closed',
      ])
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

const scriptedSnapshot = sessionSnapshot([], [], { workspaces: [], tabs: [] })

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

const sequencedLayer = Layer.unwrap(
  Effect.map(Queue.unbounded<HerdrEvent, HerdrSubscriptionError>(), (events) =>
    HerdrClient.layerTest({
      responses: [
        scriptedRejection(AgentStartMethod, 'agent_pane_busy', 'not an available shell'),
        scriptedRejection(AgentStartMethod, 'invalid_agent_name', 'bad name'),
      ],
      events,
    }),
  ),
)

layer(sequencedLayer)('HerdrClient.layerTest with several answers for one method', (it) => {
  it.effect('answers in the order they are scripted, then keeps giving the last one', () =>
    Effect.gen(function* () {
      const client = yield* HerdrClient
      const start = client
        .request(AgentStartMethod, { name: 'crook-1', kind: 'claude', pane_id: 'w1:p2' })
        .pipe(Effect.flip)
      const answers = yield* Effect.all([start, start, start])

      expect(answers.map((answer) => answer.name)).toEqual([
        'HerdrPaneBusy',
        'HerdrRequestRejected',
        'HerdrRequestRejected',
      ])
    }),
  )
})
