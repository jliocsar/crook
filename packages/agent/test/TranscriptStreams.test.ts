import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import * as AgentDaemon from '@crook/agent/AgentDaemon'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { TaskLiveness } from '@crook/agent/TaskLiveness'
import { type TranscriptLink, TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { BackgroundWork } from '@crook/claude/BackgroundWork'
import { FileWatch } from '@crook/claude/FileWatch'
import { SkillCatalog } from '@crook/claude/SkillCatalog'
import { SubagentRoster } from '@crook/claude/SubagentRoster'
import { TranscriptLocator } from '@crook/claude/TranscriptLocator'
import { TranscriptTail } from '@crook/claude/TranscriptTail'
import { ClaudeSessionId, PaneId, SubagentId, TranscriptOffset } from '@crook/domain/Ids'
import type { MachineState } from '@crook/domain/MachineState'
import { SkillListing } from '@crook/domain/Skill'
import {
  CHUNK_READ_LIMIT,
  PaneTranscript,
  SkillsChanged,
  SubagentTranscript,
  type TranscriptEvent,
  TranscriptPosition,
  TranscriptTailBytes,
  continuesFrom,
  positionAfter,
} from '@crook/domain/Transcript'
import {
  TranscriptDemand,
  TranscriptOutOfStep,
  TranscriptReadFailed,
  TranscriptSessionRejected,
  type TranscriptUpdate,
  TranscriptWatch,
  TranscriptWatchId,
  isWatchFailed,
} from '@crook/protocol/Transcripts'

import { agentRow, machineStateWith } from './Fixtures'

const skillFile = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nDo the thing.\n`

const FIRST_SESSION = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
const CLEARED_SESSION = ClaudeSessionId.make('5b1e7c2a-8d34-4f6e-9a0b-c7d2e1f3a4b5')
const SUBAGENT = SubagentId.make('a370777a87a436836')
const PANE = PaneId.make('w1:p1')
const PROJECT = '-home-jliocsar-Projects-crook'
const WATCH = TranscriptWatchId.make(0)
const REPLACEMENT_WATCH = TranscriptWatchId.make(1)
const SLOWEST_MEASURED_WATCH_INSTALL = Duration.millis(8)
const WATCHERS_SETTLED = Duration.times(SLOWEST_MEASURED_WATCH_INSTALL, 10)
const LOCATOR_BUG = 'the locator broke'

const userLine = (text: string) =>
  `${encodeJson({
    type: 'user',
    uuid: `user-${text}`,
    timestamp: '2026-10-20T17:52:35.958Z',
    message: { role: 'user', content: text },
  })}\n`

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const bytesOf = (text: string) => new TextEncoder().encode(text).byteLength

const describe = (event: TranscriptEvent) =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: (opened) => `opened ${opened.session}`,
      TranscriptChunk: (chunk) =>
        `chunk ${chunk.session} ${chunk.offset}-${chunk.nextOffset} ${chunk.messages.length}`,
      SubagentsChanged: (changed) =>
        `subagents ${changed.session} ${changed.subagents.map((subagent) => subagent.id).join(',')}`,
      SkillsChanged: (changed) => `skills ${changed.session}`,
      BackgroundChanged: (changed) =>
        `background ${changed.session} ${changed.tasks.map((task) => `${task.taskId} ${task.status}`).join(',')}`,
      TranscriptCaughtUp: (caughtUp) => `caught up ${caughtUp.session} ${caughtUp.offset}`,
    }),
  )

const describeUpdate = (update: TranscriptUpdate) =>
  Match.value(update).pipe(
    Match.tag('TranscriptWatchFailed', (failed) => `failed ${failed.failure.message}`),
    Match.orElse(describe),
  )

const stateOn = (session: Option.Option<ClaudeSessionId>) =>
  machineStateWith([agentRow({ claudeSession: session })])

const claudeRoot = Effect.fn('claudeRoot')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()

  yield* fileSystem.makeDirectory(`${root}/projects/${PROJECT}`, { recursive: true })

  return root
})

const transcriptPath = (root: string, session: ClaudeSessionId) =>
  `${root}/projects/${PROJECT}/${session}.jsonl`

const subagentsPath = (root: string, session: ClaudeSessionId) =>
  `${root}/projects/${PROJECT}/${session}/subagents`

const append = Effect.fn('append')(function* (path: string, text: string) {
  const fileSystem = yield* FileSystem.FileSystem

  yield* fileSystem.writeFileString(path, text, { flag: 'a' })
})

const streamsAt = Effect.fn('streamsAt')(function* (
  root: string,
  state: SubscriptionRef.SubscriptionRef<MachineState>,
) {
  const context = yield* Layer.build(
    Layer.provide(AgentDaemon.transcriptStreamingAt([root]), MachineStateSync.layerTest(state)),
  )

  return Context.get(context, TranscriptStreams)
})

const defectiveStreams = Effect.fn('defectiveStreams')(function* (
  state: SubscriptionRef.SubscriptionRef<MachineState>,
) {
  const brokenLocator = Layer.succeed(
    TranscriptLocator,
    TranscriptLocator.of({
      locate: () => Effect.die(new Error(LOCATOR_BUG)),
      await: () => Effect.die(new Error(LOCATOR_BUG)),
      awaitSubagent: () => Effect.die(new Error(LOCATOR_BUG)),
    }),
  )
  const watchedTail = Layer.provideMerge(TranscriptTail.layer, FileWatch.layer)
  const subagentRoster = Layer.provideMerge(SubagentRoster.layer, watchedTail)
  const backgroundWork = Layer.provideMerge(BackgroundWork.layer, subagentRoster)
  const context = yield* Layer.build(
    Layer.provide(TranscriptStreams.layer, [
      brokenLocator,
      backgroundWork,
      SkillCatalog.layerAt([], []),
      TaskLiveness.layerTest(() => Option.none()),
      MachineStateSync.layerTest(state),
    ]),
  )

  return Context.get(context, TranscriptStreams)
})

const collect = Effect.fn('collect')(function* (stream: Stream.Stream<TranscriptEvent, unknown>) {
  const events = yield* Queue.unbounded<string>()

  yield* stream.pipe(
    Stream.runForEach((event) => Queue.offer(events, describe(event))),
    Effect.forkScoped,
  )

  return events
})

const takeAll = (events: Queue.Queue<string>, count: number) =>
  Effect.forEach(Array.from({ length: count }), () => Queue.take(events))

const positionAt = (session: ClaudeSessionId, offset: number) =>
  Option.some(new TranscriptPosition({ session, offset: TranscriptOffset.make(offset) }))

const fakeHub = Effect.fn('fakeHub')(function* (
  demands: Queue.Queue<TranscriptDemand>,
  expected: Option.Option<TranscriptPosition>,
) {
  const accepted = yield* Queue.unbounded<string>()
  const positions = yield* Ref.make(
    HashMap.empty<TranscriptWatchId, Option.Option<TranscriptPosition>>(),
  )

  const positionOf = (watch: TranscriptWatchId) =>
    Effect.map(Ref.get(positions), (known) =>
      Option.getOrElse(HashMap.get(known, watch), () => expected),
    )

  const record = (watch: TranscriptWatchId, line: string) =>
    Queue.offer(accepted, `${watch} ${line}`).pipe(Effect.andThen(Effect.void))

  const move = (watch: TranscriptWatchId, event: TranscriptEvent) =>
    Effect.flatMap(positionOf(watch), (at) =>
      Ref.update(positions, HashMap.set(watch, positionAfter(at, event))),
    )

  const accept = (watch: TranscriptWatchId, update: TranscriptUpdate) =>
    Match.value(update).pipe(
      Match.tagsExhaustive({
        TranscriptWatchFailed: (failed) => record(watch, `failed ${failed.failure.message}`),
        TranscriptOpened: (opened) =>
          Effect.andThen(move(watch, opened), record(watch, describe(opened))),
        SubagentsChanged: (changed) => record(watch, describe(changed)),
        SkillsChanged: (changed) => record(watch, describe(changed)),
        BackgroundChanged: (changed) => record(watch, describe(changed)),
        TranscriptCaughtUp: (caughtUp) => record(watch, describe(caughtUp)),
        TranscriptChunk: (chunk) =>
          Effect.flatMap(positionOf(watch), (at) =>
            continuesFrom(at, chunk)
              ? Effect.andThen(move(watch, chunk), record(watch, describe(chunk)))
              : Effect.andThen(
                  record(watch, `rejected ${describe(chunk)}`),
                  Effect.fail(new TranscriptOutOfStep({ watch, expected: at })),
                ),
          ),
      }),
    )

  const link: TranscriptLink = {
    demands: Stream.fromQueue(demands),
    publish: (watch, updates) =>
      Effect.forEach(updates, (update) => accept(watch, update), { discard: true }),
  }

  return { accepted, link }
})

layer(Layer.mergeAll(BunFileSystem.layer, Path.layer), { excludeTestServices: true })(
  'TranscriptStreams',
  (it) => {
    it.effect('opens the pane session, waits for its first prompt, then follows appends', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const events = yield* collect(
          streams.follow(new PaneTranscript({ pane: PANE }), Option.none(), Option.none()),
        )

        expect(yield* takeAll(events, 3)).toEqual([
          `opened ${FIRST_SESSION}`,
          `skills ${FIRST_SESSION}`,
          `caught up ${FIRST_SESSION} 0`,
        ])

        const first = userLine('first')

        yield* append(transcriptPath(root, FIRST_SESSION), first)

        expect(yield* takeAll(events, 2)).toEqual([
          `chunk ${FIRST_SESSION} 0-${bytesOf(first)} 1`,
          `caught up ${FIRST_SESSION} ${bytesOf(first)}`,
        ])

        const second = userLine('second')

        yield* append(transcriptPath(root, FIRST_SESSION), second)

        expect(yield* Queue.take(events)).toBe(
          `chunk ${FIRST_SESSION} ${bytesOf(first)}-${bytesOf(first + second)} 1`,
        )
      }),
    )

    it.effect('waits for a pane that has no Claude session yet', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const line = userLine('hello')

        yield* append(transcriptPath(root, FIRST_SESSION), line)

        const state = yield* SubscriptionRef.make(stateOn(Option.none()))
        const streams = yield* streamsAt(root, state)
        const events = yield* collect(
          streams.follow(new PaneTranscript({ pane: PANE }), Option.none(), Option.none()),
        )

        yield* SubscriptionRef.set(state, stateOn(Option.some(FIRST_SESSION)))

        expect(yield* takeAll(events, 3)).toEqual([
          `opened ${FIRST_SESSION}`,
          `skills ${FIRST_SESSION}`,
          `chunk ${FIRST_SESSION} 0-${bytesOf(line)} 1`,
        ])
      }),
    )

    it.effect('signals /clear by opening the new session and following it from its start', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const before = userLine('before')
        const after = userLine('after')

        yield* append(transcriptPath(root, FIRST_SESSION), before)
        yield* append(transcriptPath(root, CLEARED_SESSION), after)

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const events = yield* collect(
          streams.follow(new PaneTranscript({ pane: PANE }), Option.none(), Option.none()),
        )

        expect(yield* takeAll(events, 4)).toEqual([
          `opened ${FIRST_SESSION}`,
          `skills ${FIRST_SESSION}`,
          `chunk ${FIRST_SESSION} 0-${bytesOf(before)} 1`,
          `caught up ${FIRST_SESSION} ${bytesOf(before)}`,
        ])

        yield* SubscriptionRef.set(state, stateOn(Option.some(CLEARED_SESSION)))

        expect(yield* takeAll(events, 3)).toEqual([
          `opened ${CLEARED_SESSION}`,
          `skills ${CLEARED_SESSION}`,
          `chunk ${CLEARED_SESSION} 0-${bytesOf(after)} 1`,
        ])
      }),
    )

    it.effect('resumes from a byte offset in the current session', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const seen = userLine('seen')
        const missed = userLine('missed')

        yield* append(transcriptPath(root, FIRST_SESSION), seen + missed)

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const events = yield* collect(
          streams.follow(
            new PaneTranscript({ pane: PANE }),
            positionAt(FIRST_SESSION, bytesOf(seen)),
            Option.none(),
          ),
        )

        expect(yield* takeAll(events, 3)).toEqual([
          `opened ${FIRST_SESSION}`,
          `skills ${FIRST_SESSION}`,
          `chunk ${FIRST_SESSION} ${bytesOf(seen)}-${bytesOf(seen + missed)} 1`,
        ])
      }),
    )

    it.effect('starts near the end when asked for a tail, and says what it left out', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const older = userLine('older') + userLine('old')
        const recent = userLine('recent')
        const later = userLine('later')

        yield* append(transcriptPath(root, FIRST_SESSION), older + recent)

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const tail = Option.some(TranscriptTailBytes.make(bytesOf(recent)))
        const fresh = yield* collect(
          streams.follow(new PaneTranscript({ pane: PANE }), Option.none(), tail),
        )

        expect(yield* takeAll(fresh, 4)).toEqual([
          `opened ${FIRST_SESSION}`,
          `skills ${FIRST_SESSION}`,
          `chunk ${FIRST_SESSION} 0-${bytesOf(older)} 1`,
          `chunk ${FIRST_SESSION} ${bytesOf(older)}-${bytesOf(older + recent)} 1`,
        ])

        yield* append(transcriptPath(root, FIRST_SESSION), later)
        const resumed = yield* collect(
          streams.follow(
            new PaneTranscript({ pane: PANE }),
            positionAt(FIRST_SESSION, bytesOf(older + recent)),
            tail,
          ),
        )

        expect(yield* takeAll(resumed, 3)).toEqual([
          `opened ${FIRST_SESSION}`,
          `skills ${FIRST_SESSION}`,
          `chunk ${FIRST_SESSION} ${bytesOf(older + recent)}-${bytesOf(older + recent + later)} 1`,
        ])
      }),
    )

    it.effect('skips a gap one read cannot cover, marks it, and reads on from the tail', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const seen = userLine('seen')
        const missed = userLine('x'.repeat(CHUNK_READ_LIMIT))
        const recent = userLine('recent')
        const all = seen + missed + recent

        yield* append(transcriptPath(root, FIRST_SESSION), all)

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const skipping = yield* collect(
          streams.follow(
            new PaneTranscript({ pane: PANE }),
            positionAt(FIRST_SESSION, bytesOf(seen)),
            Option.some(TranscriptTailBytes.make(bytesOf(recent))),
          ),
        )
        const whole = yield* collect(
          streams.follow(
            new PaneTranscript({ pane: PANE }),
            positionAt(FIRST_SESSION, bytesOf(seen)),
            Option.none(),
          ),
        )

        expect(yield* takeAll(skipping, 4)).toEqual([
          `opened ${FIRST_SESSION}`,
          `skills ${FIRST_SESSION}`,
          `chunk ${FIRST_SESSION} ${bytesOf(seen)}-${bytesOf(seen + missed)} 1`,
          `chunk ${FIRST_SESSION} ${bytesOf(seen + missed)}-${bytesOf(all)} 1`,
        ])
        expect(yield* takeAll(whole, 3)).toEqual([
          `opened ${FIRST_SESSION}`,
          `skills ${FIRST_SESSION}`,
          `chunk ${FIRST_SESSION} ${bytesOf(seen)}-${bytesOf(all)} 2`,
        ])
      }),
    )

    it.effect('opens the session a /clear makes near its end when the watch has a tail', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const before = userLine('before')
        const skipped = userLine('skipped')
        const recent = userLine('recent')

        yield* append(transcriptPath(root, FIRST_SESSION), before)
        yield* append(transcriptPath(root, CLEARED_SESSION), skipped + recent)

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const events = yield* collect(
          streams.follow(
            new PaneTranscript({ pane: PANE }),
            Option.none(),
            Option.some(TranscriptTailBytes.make(bytesOf(recent))),
          ),
        )

        expect(yield* takeAll(events, 4)).toEqual([
          `opened ${FIRST_SESSION}`,
          `skills ${FIRST_SESSION}`,
          `chunk ${FIRST_SESSION} 0-${bytesOf(before)} 1`,
          `caught up ${FIRST_SESSION} ${bytesOf(before)}`,
        ])

        yield* SubscriptionRef.set(state, stateOn(Option.some(CLEARED_SESSION)))

        expect(yield* takeAll(events, 4)).toEqual([
          `opened ${CLEARED_SESSION}`,
          `skills ${CLEARED_SESSION}`,
          `chunk ${CLEARED_SESSION} 0-${bytesOf(skipped)} 1`,
          `chunk ${CLEARED_SESSION} ${bytesOf(skipped)}-${bytesOf(skipped + recent)} 1`,
        ])
      }),
    )

    it.effect('follows a subagent transcript from near its end when the watch has a tail', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* claudeRoot()
        const skipped = userLine('skipped')
        const recent = userLine('recent')
        const subagentFile = `${subagentsPath(root, FIRST_SESSION)}/agent-${SUBAGENT}.jsonl`

        yield* append(transcriptPath(root, FIRST_SESSION), userLine('spawn'))
        yield* fileSystem.makeDirectory(subagentsPath(root, FIRST_SESSION), { recursive: true })
        yield* append(subagentFile, skipped + recent)

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const events = yield* collect(
          streams.follow(
            new SubagentTranscript({ session: FIRST_SESSION, subagent: SUBAGENT }),
            Option.none(),
            Option.some(TranscriptTailBytes.make(bytesOf(recent))),
          ),
        )

        expect(yield* takeAll(events, 3)).toEqual([
          `opened ${FIRST_SESSION}`,
          `chunk ${FIRST_SESSION} 0-${bytesOf(skipped)} 1`,
          `chunk ${FIRST_SESSION} ${bytesOf(skipped)}-${bytesOf(skipped + recent)} 1`,
        ])
      }),
    )

    it.effect('reads a file no larger than the tail whole, with nothing left out', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const whole = userLine('first') + userLine('second')

        yield* append(transcriptPath(root, FIRST_SESSION), whole)

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const events = yield* collect(
          streams.follow(
            new PaneTranscript({ pane: PANE }),
            Option.none(),
            Option.some(TranscriptTailBytes.make(bytesOf(whole))),
          ),
        )

        expect(yield* takeAll(events, 3)).toEqual([
          `opened ${FIRST_SESSION}`,
          `skills ${FIRST_SESSION}`,
          `chunk ${FIRST_SESSION} 0-${bytesOf(whole)} 2`,
        ])
      }),
    )

    it.effect(
      'opens the session cleared into from its start, reading nothing of the one left',
      () =>
        Effect.gen(function* () {
          const root = yield* claudeRoot()
          const seen = userLine('seen')
          const missed = userLine('missed')
          const after = userLine('after')

          yield* append(transcriptPath(root, FIRST_SESSION), seen + missed)
          yield* append(transcriptPath(root, CLEARED_SESSION), after)

          const state = yield* SubscriptionRef.make(stateOn(Option.some(CLEARED_SESSION)))
          const streams = yield* streamsAt(root, state)
          const events = yield* collect(
            streams.follow(
              new PaneTranscript({ pane: PANE }),
              positionAt(FIRST_SESSION, bytesOf(seen)),
              Option.none(),
            ),
          )

          expect(yield* takeAll(events, 3)).toEqual([
            `opened ${CLEARED_SESSION}`,
            `skills ${CLEARED_SESSION}`,
            `chunk ${CLEARED_SESSION} 0-${bytesOf(after)} 1`,
          ])
        }),
    )

    it.effect(
      'lists the skills of the pane folder and of the Claude folder its session lives in',
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const root = yield* claudeRoot()
          const project = yield* fileSystem.makeTempDirectoryScoped()

          yield* fileSystem.makeDirectory(`${root}/skills/recap`, { recursive: true })
          yield* fileSystem.writeFileString(
            `${root}/skills/recap/SKILL.md`,
            skillFile('recap', 'Restate the next steps'),
          )
          yield* fileSystem.makeDirectory(`${project}/.git`)
          yield* fileSystem.makeDirectory(`${project}/.claude/skills/prototype`, {
            recursive: true,
          })
          yield* fileSystem.writeFileString(
            `${project}/.claude/skills/prototype/SKILL.md`,
            skillFile('prototype', 'Build several versions of a UI piece'),
          )

          const state = yield* SubscriptionRef.make(
            machineStateWith([
              agentRow({ claudeSession: Option.some(FIRST_SESSION), cwd: project }),
            ]),
          )
          const streams = yield* streamsAt(root, state)
          const events = yield* streams
            .follow(new PaneTranscript({ pane: PANE }), Option.none(), Option.none())
            .pipe(Stream.take(2), Stream.runCollect)

          expect(events[1]).toEqual(
            new SkillsChanged({
              session: FIRST_SESSION,
              skills: [
                new SkillListing({
                  name: 'prototype',
                  description: 'Build several versions of a UI piece',
                  argumentHint: Option.none(),
                  scope: 'project',
                }),
                new SkillListing({
                  name: 'recap',
                  description: 'Restate the next steps',
                  argumentHint: Option.none(),
                  scope: 'personal',
                }),
              ],
            }),
          )
        }),
    )

    it.effect('lists the subagents of the pane session as their meta files appear', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* claudeRoot()
        const line = userLine('spawn')

        yield* append(transcriptPath(root, FIRST_SESSION), line)

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const events = yield* collect(
          streams.follow(new PaneTranscript({ pane: PANE }), Option.none(), Option.none()),
        )

        expect(yield* takeAll(events, 4)).toEqual([
          `opened ${FIRST_SESSION}`,
          `skills ${FIRST_SESSION}`,
          `chunk ${FIRST_SESSION} 0-${bytesOf(line)} 1`,
          `caught up ${FIRST_SESSION} ${bytesOf(line)}`,
        ])

        yield* fileSystem.makeDirectory(subagentsPath(root, FIRST_SESSION), { recursive: true })
        yield* fileSystem.writeFileString(
          `${subagentsPath(root, FIRST_SESSION)}/agent-${SUBAGENT}.meta.json`,
          encodeJson({
            agentType: 'general-purpose',
            description: 'Read hello.txt',
            spawnDepth: 1,
          }),
        )

        expect(yield* Queue.take(events)).toBe(`subagents ${FIRST_SESSION} ${SUBAGENT}`)
      }),
    )

    it.effect('follows a subagent transcript once it exists', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* claudeRoot()

        yield* append(transcriptPath(root, FIRST_SESSION), userLine('spawn'))

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const events = yield* collect(
          streams.follow(
            new SubagentTranscript({ session: FIRST_SESSION, subagent: SUBAGENT }),
            Option.none(),
            Option.none(),
          ),
        )

        expect(yield* Queue.take(events)).toBe(`opened ${FIRST_SESSION}`)

        const line = userLine('subagent prompt')

        yield* fileSystem.makeDirectory(subagentsPath(root, FIRST_SESSION), { recursive: true })
        yield* append(`${subagentsPath(root, FIRST_SESSION)}/agent-${SUBAGENT}.jsonl`, line)

        expect(yield* Queue.take(events)).toBe(`chunk ${FIRST_SESSION} 0-${bytesOf(line)} 1`)
      }),
    )

    it.effect('restarts a watch from where the hub says the last chunk ended', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const seen = userLine('seen')
        const missed = userLine('missed')

        yield* append(transcriptPath(root, FIRST_SESSION), seen + missed)

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const demands = yield* Queue.unbounded<TranscriptDemand>()
        const hub = yield* fakeHub(demands, positionAt(FIRST_SESSION, 0))

        yield* Effect.forkScoped(streams.serve(hub.link))
        yield* Queue.offer(
          demands,
          new TranscriptDemand({
            watches: [
              new TranscriptWatch({
                id: WATCH,
                source: new PaneTranscript({ pane: PANE }),
                from: positionAt(FIRST_SESSION, bytesOf(seen)),
                tail: Option.none(),
              }),
            ],
          }),
        )

        expect(yield* takeAll(hub.accepted, 6)).toEqual([
          `0 opened ${FIRST_SESSION}`,
          `0 rejected chunk ${FIRST_SESSION} ${bytesOf(seen)}-${bytesOf(seen + missed)} 1`,
          `0 opened ${FIRST_SESSION}`,
          `0 chunk ${FIRST_SESSION} 0-${bytesOf(seen + missed)} 2`,
          `0 caught up ${FIRST_SESSION} ${bytesOf(seen + missed)}`,
          `0 skills ${FIRST_SESSION}`,
        ])
      }),
    )

    it.effect('tells the phone a watch failed when its publish dies', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const first = userLine('first')

        yield* append(transcriptPath(root, FIRST_SESSION), first)

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const demands = yield* Queue.unbounded<TranscriptDemand>()
        const published = yield* Queue.unbounded<readonly TranscriptUpdate[]>()
        const calls = yield* Ref.make(0)
        const link: TranscriptLink = {
          demands: Stream.fromQueue(demands),
          publish: (_watch, updates) =>
            Effect.flatMap(
              Ref.getAndUpdate(calls, (count) => count + 1),
              (count) =>
                count === 0 ? Effect.die('cannot encode this') : Queue.offer(published, updates),
            ),
        }

        yield* Effect.forkScoped(streams.serve(link))
        yield* Queue.offer(
          demands,
          new TranscriptDemand({
            watches: [
              new TranscriptWatch({
                id: WATCH,
                source: new PaneTranscript({ pane: PANE }),
                from: Option.none(),
                tail: Option.none(),
              }),
            ],
          }),
        )

        expect((yield* Queue.take(published)).map(isWatchFailed)).toEqual([true])
      }),
    )

    it.effect(
      'sends an opening with what it caught up on, and a burst behind a publish as one',
      () =>
        Effect.gen(function* () {
          const root = yield* claudeRoot()
          const path = transcriptPath(root, FIRST_SESSION)
          const first = userLine('first')
          const burst = [userLine('one'), userLine('two'), userLine('three')]

          yield* append(path, first)

          const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
          const streams = yield* streamsAt(root, state)
          const demands = yield* Queue.unbounded<TranscriptDemand>()
          const published = yield* Queue.unbounded<readonly string[]>()
          const answered = yield* Deferred.make<void>()
          const link: TranscriptLink = {
            demands: Stream.fromQueue(demands),
            publish: (watch, updates) =>
              Effect.andThen(
                Queue.offer(
                  published,
                  Arr.map(updates, (update) => `${watch} ${describeUpdate(update)}`),
                ),
                Deferred.await(answered),
              ),
          }

          yield* Effect.forkScoped(streams.serve(link))
          yield* Queue.offer(
            demands,
            new TranscriptDemand({
              watches: [
                new TranscriptWatch({
                  id: WATCH,
                  source: new PaneTranscript({ pane: PANE }),
                  from: Option.none(),
                  tail: Option.none(),
                }),
              ],
            }),
          )

          expect(yield* Queue.take(published)).toEqual([
            `0 opened ${FIRST_SESSION}`,
            `0 chunk ${FIRST_SESSION} 0-${bytesOf(first)} 1`,
            `0 caught up ${FIRST_SESSION} ${bytesOf(first)}`,
            `0 skills ${FIRST_SESSION}`,
          ])

          yield* Effect.forEach(burst, (line) => append(path, line), { discard: true })
          yield* Effect.sleep(WATCHERS_SETTLED)
          yield* Deferred.succeed(answered, undefined)

          const whole = bytesOf(first + burst.join(''))
          const publishes = yield* Stream.fromQueue(published).pipe(
            Stream.takeUntil(Arr.some((update) => update.includes(`-${whole} `))),
            Stream.runCollect,
          )

          expect(publishes.length).toBeLessThan(burst.length)
          expect(publishes[0]?.[0]).toContain(`0 chunk ${FIRST_SESSION} ${bytesOf(first)}-`)
        }),
    )

    it.effect('stops a watch the hub no longer asks for', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const first = userLine('first')
        const second = userLine('second')

        yield* append(transcriptPath(root, FIRST_SESSION), first)

        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* streamsAt(root, state)
        const demands = yield* Queue.unbounded<TranscriptDemand>()
        const hub = yield* fakeHub(demands, Option.none())
        const watchFor = (id: TranscriptWatchId) =>
          new TranscriptWatch({
            id,
            source: new PaneTranscript({ pane: PANE }),
            from: Option.none(),
            tail: Option.none(),
          })

        yield* Effect.forkScoped(streams.serve(hub.link))
        yield* Queue.offer(demands, new TranscriptDemand({ watches: [watchFor(WATCH)] }))

        expect(yield* takeAll(hub.accepted, 4)).toEqual([
          `0 opened ${FIRST_SESSION}`,
          `0 chunk ${FIRST_SESSION} 0-${bytesOf(first)} 1`,
          `0 caught up ${FIRST_SESSION} ${bytesOf(first)}`,
          `0 skills ${FIRST_SESSION}`,
        ])

        yield* Queue.offer(demands, new TranscriptDemand({ watches: [] }))
        yield* Queue.offer(
          demands,
          new TranscriptDemand({ watches: [watchFor(REPLACEMENT_WATCH)] }),
        )

        expect(yield* takeAll(hub.accepted, 4)).toEqual([
          `1 opened ${FIRST_SESSION}`,
          `1 chunk ${FIRST_SESSION} 0-${bytesOf(first)} 1`,
          `1 caught up ${FIRST_SESSION} ${bytesOf(first)}`,
          `1 skills ${FIRST_SESSION}`,
        ])

        yield* append(transcriptPath(root, FIRST_SESSION), second)

        expect(yield* Queue.take(hub.accepted)).toBe(
          `1 chunk ${FIRST_SESSION} ${bytesOf(first)}-${bytesOf(first + second)} 1`,
        )

        yield* Effect.sleep(WATCHERS_SETTLED)

        expect(yield* Queue.size(hub.accepted)).toBe(0)
      }),
    )

    it.effect('tells the hub when a watch cannot run', () =>
      Effect.gen(function* () {
        const root = yield* claudeRoot()
        const state = yield* SubscriptionRef.make(stateOn(Option.none()))
        const streams = yield* streamsAt(root, state)
        const demands = yield* Queue.unbounded<TranscriptDemand>()
        const hub = yield* fakeHub(demands, Option.none())
        const unsafe = ClaudeSessionId.make('../escape')

        yield* Effect.forkScoped(streams.serve(hub.link))
        yield* Queue.offer(
          demands,
          new TranscriptDemand({
            watches: [
              new TranscriptWatch({
                id: WATCH,
                source: new SubagentTranscript({ session: unsafe, subagent: SUBAGENT }),
                from: Option.none(),
                tail: Option.none(),
              }),
            ],
          }),
        )

        expect(yield* takeAll(hub.accepted, 2)).toEqual([
          `0 opened ${unsafe}`,
          `0 failed ${new TranscriptSessionRejected({ session: unsafe }).message}`,
        ])
      }),
    )

    it.effect('tells the hub when a watch dies of a defect, instead of going quiet', () =>
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.make(stateOn(Option.some(FIRST_SESSION)))
        const streams = yield* defectiveStreams(state)
        const demands = yield* Queue.unbounded<TranscriptDemand>()
        const hub = yield* fakeHub(demands, Option.none())

        yield* Effect.forkScoped(streams.serve(hub.link))
        yield* Queue.offer(
          demands,
          new TranscriptDemand({
            watches: [
              new TranscriptWatch({
                id: WATCH,
                source: new PaneTranscript({ pane: PANE }),
                from: Option.none(),
                tail: Option.none(),
              }),
            ],
          }),
        )
        const [opened, failed] = yield* takeAll(hub.accepted, 2)

        expect(opened).toBe(`0 opened ${FIRST_SESSION}`)
        expect(failed).toContain(
          `0 failed ${new TranscriptReadFailed({ detail: 'a bug in the crook agent stopped the watch: ' }).message}`,
        )
        expect(failed).toContain(LOCATOR_BUG)
      }),
    )
  },
)
