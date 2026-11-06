import { expect, layer } from '@effect/vitest'
import type { NonEmptyReadonlyArray } from 'effect/Array'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import type * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'

import { ClaudeSessionId, MachineId, TranscriptOffset } from '@crook/domain/Ids'
import {
  PaneTranscript,
  TranscriptCaughtUp,
  TranscriptChunk,
  type TranscriptEvent,
  TranscriptOpened,
} from '@crook/domain/Transcript'
import { UnrecognizedEntry } from '@crook/domain/TranscriptMessage'
import { AgentLink } from '@crook/protocol/AgentLink'
import { ClientApi } from '@crook/protocol/ClientApi'
import { AGENT_PATH, CLIENT_PATH } from '@crook/protocol/HubRoutes'
import type { TranscriptUpdate, TranscriptWatchId } from '@crook/protocol/Transcripts'

import {
  PANE,
  agentRow,
  agentToken,
  connect,
  machineShows,
  machineStateWith,
  ownerLogin,
  testHub,
} from './Fixtures'
import { agentThroughProxy, attach, heldProxy, hubPort, replyFrom } from './HeldProxy'

const LEFT_SESSION = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
const CURRENT_SESSION = ClaudeSessionId.make('5b1e7c2a-8d34-4f6e-9a0b-c7d2e1f3a4b5')

const chunkOf = (session: ClaudeSessionId, offset: number, nextOffset: number) =>
  new TranscriptChunk({
    session,
    offset: TranscriptOffset.make(offset),
    nextOffset: TranscriptOffset.make(nextOffset),
    messages: [new UnrecognizedEntry({ offset: TranscriptOffset.make(offset), entryType: 'line' })],
  })

const describeEvent = (event: TranscriptEvent) =>
  Match.value(event).pipe(
    Match.tag('TranscriptOpened', (opened) => `opened ${opened.session}`),
    Match.tag(
      'TranscriptChunk',
      (chunk) => `chunk ${chunk.session} ${chunk.offset}-${chunk.nextOffset}`,
    ),
    Match.tag('TranscriptCaughtUp', (caughtUp) => `caught up ${caughtUp.session}`),
    Match.orElse(() => 'other'),
  )

const stateOn = (machine: MachineId) =>
  machineStateWith(machine, 1, [
    agentRow({
      status: 'idle',
      claudeSession: Option.some(CURRENT_SESSION),
      statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
    }),
  ])

const firstWatch = (client: RpcClient.FromGroup<typeof AgentLink, RpcClientError>) =>
  client.TranscriptDemands().pipe(
    Stream.filter((demand) => demand.watches.length > 0),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
    Effect.map((demand) => demand.watches[0]),
    Effect.flatMap(Effect.fromNullishOr),
  )

const watchOnPhone = (machine: MachineId) =>
  Effect.gen(function* () {
    const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
    const events = yield* Queue.unbounded<string>()

    yield* phone
      .WatchTranscript({
        machine,
        source: new PaneTranscript({ pane: PANE }),
        from: Option.none(),
        tail: Option.none(),
      })
      .pipe(
        Stream.runForEach((event) => Queue.offer(events, describeEvent(event))),
        Effect.ignore({ log: 'Debug' }),
        Effect.forkScoped,
      )

    return events
  })

const takeAll = (events: Queue.Queue<string>, count: number) =>
  Effect.forEach(
    Arr.makeBy(count, () => events),
    Queue.take,
  )

const stalePublishOf = Effect.fn('stalePublishOf')(function* (machine: MachineId) {
  const proxy = yield* heldProxy(yield* hubPort)
  const socketScope = yield* Scope.fork(yield* Effect.scope)

  const dying = yield* agentThroughProxy(proxy.port, machine).pipe(Scope.provide(socketScope))

  yield* attach(dying).pipe(Scope.provide(socketScope))
  yield* dying.PublishState({ state: stateOn(machine) })
  yield* machineShows(machine, 'online')

  const events = yield* watchOnPhone(machine)
  const { id } = yield* firstWatch(dying)
  const stale: NonEmptyReadonlyArray<TranscriptUpdate> = [
    new TranscriptOpened({ session: LEFT_SESSION }),
    chunkOf(LEFT_SESSION, 0, 10),
    new TranscriptCaughtUp({ session: LEFT_SESSION, offset: TranscriptOffset.make(10) }),
  ]

  yield* proxy.hold

  const died = yield* dying.PublishTranscriptBatch({ watch: id, updates: stale }).pipe(Effect.exit)

  expect(Exit.isFailure(died)).toBe(true)

  yield* Scope.close(socketScope, Exit.void)

  return { proxy, events, id }
})

const publishFromSuccessor = (
  client: RpcClient.FromGroup<typeof AgentLink, RpcClientError>,
  id: TranscriptWatchId,
  updates: NonEmptyReadonlyArray<TranscriptUpdate>,
) => client.PublishTranscriptBatch({ watch: id, updates })

layer(testHub, { excludeTestServices: true })('A publish from a dead socket', (live) => {
  live.effect('lands after its successor spoke and does not take the phone back', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('fence-laptop')
      const { proxy, events, id } = yield* stalePublishOf(machine)
      const successor = yield* connect(AgentLink, AGENT_PATH, agentToken(machine))

      yield* attach(successor)
      yield* successor.PublishState({ state: stateOn(machine) })

      const watch = yield* firstWatch(successor)

      expect(watch.id).toBe(id)
      expect(Option.isNone(watch.from)).toBe(true)

      yield* publishFromSuccessor(successor, id, [
        new TranscriptOpened({ session: LEFT_SESSION }),
        chunkOf(LEFT_SESSION, 0, 10),
        new TranscriptOpened({ session: CURRENT_SESSION }),
        chunkOf(CURRENT_SESSION, 0, 20),
      ])

      expect(yield* takeAll(events, 4)).toEqual([
        `opened ${LEFT_SESSION}`,
        `chunk ${LEFT_SESSION} 0-10`,
        `opened ${CURRENT_SESSION}`,
        `chunk ${CURRENT_SESSION} 0-20`,
      ])

      yield* publishFromSuccessor(successor, id, [
        new TranscriptCaughtUp({ session: CURRENT_SESSION, offset: TranscriptOffset.make(20) }),
      ])

      expect(yield* Queue.take(events)).toBe(`caught up ${CURRENT_SESSION}`)

      yield* Queue.clear(proxy.replies)
      yield* proxy.releaseFirstHeld
      yield* replyFrom(proxy.replies, '"Exit"')

      const next = yield* publishFromSuccessor(successor, id, [
        chunkOf(CURRENT_SESSION, 20, 30),
      ]).pipe(Effect.exit)

      expect(Exit.isSuccess(next)).toBe(true)
      expect(yield* Queue.take(events)).toBe(`chunk ${CURRENT_SESSION} 20-30`)
    }),
  )
})
