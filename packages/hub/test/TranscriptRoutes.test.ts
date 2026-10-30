import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { ClaudeSessionId, MachineId, PaneId, TranscriptOffset } from '@crook/domain/Ids'
import {
  PaneTranscript,
  type TranscriptEvent,
  TranscriptPosition,
  TranscriptTailBytes,
} from '@crook/domain/Transcript'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type SentRequest,
} from '@crook/herdr/HerdrClient'
import type { MachineState } from '@crook/domain/MachineState'
import { ClientApi, MachineNotInHerd, PaneNotInHerd } from '@crook/protocol/ClientApi'
import { CLIENT_PATH } from '@crook/protocol/HubRoutes'

import {
  PANE,
  agentRow,
  connect,
  encodeJson,
  machineShows,
  machineStateWith,
  ownerLogin,
  realAgent,
  testHub,
} from './Fixtures'

const PROJECT = '-home-jliocsar-Projects-crook'
const CLOSED_PANE = PaneId.make('w1:p9')
const FIRST_SESSION = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
const CLEARED_SESSION = ClaudeSessionId.make('5b1e7c2a-8d34-4f6e-9a0b-c7d2e1f3a4b5')

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
      SkillsChanged: (changed) => `skills ${changed.session}`,
      TranscriptCaughtUp: (caughtUp) => `caught up ${caughtUp.session} ${caughtUp.offset}`,
    }),
  )

const stateOn = (machine: MachineId, version: number, session: ClaudeSessionId) =>
  machineStateWith(machine, version, [
    agentRow({
      status: 'working',
      claudeSession: Option.some(session),
      stateChangeSeq: 4,
      statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
    }),
  ])

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
  const scope = yield* Scope.fork(yield* Effect.scope)
  const herdr = HerdrClient.layerTest({
    responses: [],
    events: yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>(),
    sent: yield* Queue.unbounded<SentRequest>(),
  })

  yield* Layer.buildWithScope(yield* realAgent(machine, state, herdr, [root]), scope)
  yield* machineShows(machine, 'online')

  return scope
})

const watchOnPhone = Effect.fn('watchOnPhone')(function* (
  machine: MachineId,
  from: Option.Option<TranscriptPosition>,
  tail: Option.Option<TranscriptTailBytes>,
) {
  const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
  const events = yield* Queue.unbounded<string>()

  yield* phone
    .WatchTranscript({
      machine,
      source: new PaneTranscript({ pane: PANE }),
      from,
      tail,
    })
    .pipe(
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
      const events = yield* watchOnPhone(machine, Option.none(), Option.none())

      expect(yield* takeAll(events, 4)).toEqual([
        `opened ${FIRST_SESSION}`,
        `chunk ${FIRST_SESSION} 0-${bytesOf(first)} 1`,
        `caught up ${FIRST_SESSION} ${bytesOf(first)}`,
        `skills ${FIRST_SESSION}`,
      ])

      yield* append(root, FIRST_SESSION, second)

      expect(yield* Queue.take(events)).toBe(
        `chunk ${FIRST_SESSION} ${bytesOf(first)}-${bytesOf(first + second)} 1`,
      )

      yield* SubscriptionRef.set(state, stateOn(machine, 2, CLEARED_SESSION))

      expect(yield* takeAll(events, 5)).toEqual([
        `subagents ${FIRST_SESSION} 0`,
        `opened ${CLEARED_SESSION}`,
        `chunk ${CLEARED_SESSION} 0-${bytesOf(cleared)} 1`,
        `caught up ${CLEARED_SESSION} ${bytesOf(cleared)}`,
        `skills ${CLEARED_SESSION}`,
      ])
    }),
  )

  live.effect('opens a phone watch near the end of the file when it asks for a tail', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('transcript-tail')
      const root = yield* claudeRoot()
      const skipped = userLine('skipped')
      const recent = userLine('recent')

      yield* append(root, FIRST_SESSION, skipped + recent)

      const state = yield* SubscriptionRef.make(stateOn(machine, 1, FIRST_SESSION))

      yield* startAgent(machine, root, state)
      const events = yield* watchOnPhone(
        machine,
        Option.none(),
        Option.some(TranscriptTailBytes.make(bytesOf(recent))),
      )

      expect(yield* takeAll(events, 4)).toEqual([
        `opened ${FIRST_SESSION}`,
        `chunk ${FIRST_SESSION} 0-${bytesOf(skipped + recent)} 2`,
        `caught up ${FIRST_SESSION} ${bytesOf(skipped + recent)}`,
        `skills ${FIRST_SESSION}`,
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
        Option.none(),
      )

      expect(yield* takeAll(events, 6)).toEqual([
        `chunk ${FIRST_SESSION} ${bytesOf(seen)}-${bytesOf(seen + missed)} 1`,
        `subagents ${FIRST_SESSION} 0`,
        `opened ${CLEARED_SESSION}`,
        `chunk ${CLEARED_SESSION} 0-${bytesOf(cleared)} 1`,
        `caught up ${CLEARED_SESSION} ${bytesOf(cleared)}`,
        `skills ${CLEARED_SESSION}`,
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
      const events = yield* watchOnPhone(machine, Option.none(), Option.none())

      expect(yield* takeAll(events, 4)).toEqual([
        `opened ${FIRST_SESSION}`,
        `chunk ${FIRST_SESSION} 0-${bytesOf(before)} 1`,
        `caught up ${FIRST_SESSION} ${bytesOf(before)}`,
        `skills ${FIRST_SESSION}`,
      ])

      yield* Scope.close(agent, Exit.void)
      yield* append(root, FIRST_SESSION, during)
      yield* startAgent(machine, root, state)

      expect(yield* takeAll(events, 3)).toEqual([
        `chunk ${FIRST_SESSION} ${bytesOf(before)}-${bytesOf(before + during)} 1`,
        `caught up ${FIRST_SESSION} ${bytesOf(before + during)}`,
        `skills ${FIRST_SESSION}`,
      ])
    }),
  )

  live.effect('refuses a transcript for a machine or a pane the herd does not have', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('transcript-refusals')
      const root = yield* claudeRoot()
      const nowhere = MachineId.make('transcript-nowhere')
      const state = yield* SubscriptionRef.make(stateOn(machine, 1, FIRST_SESSION))

      yield* startAgent(machine, root, state)
      const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
      const watchFirst = (watched: MachineId, pane: PaneId) =>
        phone
          .WatchTranscript({
            machine: watched,
            source: new PaneTranscript({ pane }),
            from: Option.none(),
            tail: Option.none(),
          })
          .pipe(Stream.runHead, Effect.flip)

      expect(yield* watchFirst(nowhere, PANE)).toEqual(new MachineNotInHerd({ machine: nowhere }))
      expect(yield* watchFirst(machine, CLOSED_PANE)).toEqual(
        new PaneNotInHerd({ machine, pane: CLOSED_PANE }),
      )
    }),
  )
})
