import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import * as AgentDaemon from '@crook/agent/AgentDaemon'
import { ClaudeSessionFiles } from '@crook/agent/ClaudeSessionFiles'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { ClaudeSessionId, PaneId, TranscriptOffset } from '@crook/domain/Ids'
import {
  CHUNK_READ_LIMIT,
  PaneTranscript,
  type TranscriptEvent,
  TranscriptPosition,
  TranscriptTailBytes,
} from '@crook/domain/Transcript'

import { agentRow, machineStateWith } from '../../../apps/agent/test/Fixtures'

const PROJECT = '-verify-transcript-pipe'
const LINE = '{"type":"verify","pad":"replaying the transcript model"}\n'
const LINE_BYTES = new TextEncoder().encode(LINE).byteLength
const SESSION_A = ClaudeSessionId.make('aaaaaaaa-0000-4000-8000-000000000000')
const SESSION_B = ClaudeSessionId.make('bbbbbbbb-0000-4000-8000-000000000000')
const PANE = PaneId.make('w1:p1')
const TAIL = TranscriptTailBytes.make(LINE_BYTES)
const BIG_LINE_BYTES = CHUNK_READ_LIMIT / 2
const BIG_LINE = `{"type":"verify","pad":"${'x'.repeat(BIG_LINE_BYTES - 27)}"}\n`
const BIG_TAIL = TranscriptTailBytes.make(BIG_LINE_BYTES)
const SETTLE_TIMEOUT = '5 seconds'

const idOf = (name: 'A' | 'B') => (name === 'A' ? SESSION_A : SESSION_B)
const nameOf = (id: ClaudeSessionId) => (id === SESSION_A ? 'A' : 'B')

interface FollowCase {
  readonly name: string
  readonly from?: readonly ['A' | 'B', number]
  readonly pane: 'A' | 'B'
  readonly lines: { readonly A?: number; readonly B?: number }
  readonly expected: readonly string[]
  readonly thenPane?: 'A' | 'B'
  readonly expectedAfter?: readonly string[]
  readonly big?: boolean
  readonly whole?: boolean
}

const CASES: readonly FollowCase[] = [
  {
    name: 'startInner(NONE, A): a cold open under the tail reads from the start',
    pane: 'A',
    lines: { A: 1 },
    expected: ['opened A', 'chunk A 0-1', 'caughtUp A'],
  },
  {
    name: 'nextChunk: a cold open over the tail marks what it left out',
    pane: 'A',
    lines: { A: 3 },
    expected: ['opened A', 'chunk A 0-3 omit 2', 'caughtUp A'],
  },
  {
    name: 'startInner(A@1, A): a resume reads on from its position',
    from: ['A', 1],
    pane: 'A',
    lines: { A: 3 },
    expected: ['opened A', 'chunk A 1-3', 'caughtUp A'],
  },
  {
    name: 'nextChunk: a resume at offset 0 still takes the tail',
    from: ['A', 0],
    pane: 'A',
    lines: { A: 3 },
    expected: ['opened A', 'chunk A 0-3 omit 2', 'caughtUp A'],
  },
  {
    name: 'startInner(A@1, B): reads nothing of the session it left, and opens the new one',
    from: ['A', 1],
    pane: 'B',
    lines: { A: 3, B: 1 },
    expected: ['opened B', 'chunk B 0-1', 'caughtUp B'],
  },
  {
    name: 'startInner(A@0, B): the same from offset 0, and over the tail it marks what it left out',
    from: ['A', 0],
    pane: 'B',
    lines: { A: 3, B: 3 },
    expected: ['opened B', 'chunk B 0-3 omit 2', 'caughtUp B'],
  },
  {
    name: 'startInner(B@1, A): going back to a session reads it from the start again',
    from: ['B', 1],
    pane: 'A',
    lines: { A: 2, B: 1 },
    expected: ['opened A', 'chunk A 0-2 omit 1', 'caughtUp A'],
  },
  {
    name: 'nextChunk: a resume reads a gap one read covers, big lines and all',
    from: ['A', 1],
    pane: 'A',
    lines: { A: 3 },
    big: true,
    expected: ['opened A', 'chunk A 1-3', 'caughtUp A'],
  },
  {
    name: 'nextChunk: a resume over a gap too big for one read marks the hole and reads the tail',
    from: ['A', 1],
    pane: 'A',
    lines: { A: 5 },
    big: true,
    expected: ['opened A', 'chunk A 1-5 omit 1-4', 'caughtUp A'],
  },
  {
    name: 'watcher.tail: a whole watch reads that same gap and leaves nothing out',
    from: ['A', 1],
    pane: 'A',
    lines: { A: 5 },
    big: true,
    whole: true,
    expected: ['opened A', 'chunk A 1-5', 'caughtUp A'],
  },
  {
    name: 'nextChunk: a cold open with no tail reads the whole file',
    pane: 'A',
    lines: { A: 3 },
    whole: true,
    expected: ['opened A', 'chunk A 0-3', 'caughtUp A'],
  },
  {
    name: 'FollowCatchesUp: a session with no file yet is caught up at once',
    pane: 'B',
    lines: {},
    expected: ['opened B', 'caughtUp B'],
  },
  {
    name: 'SwitchMapSwitches: a session change while following opens the next session',
    pane: 'A',
    lines: { A: 1, B: 1 },
    expected: ['opened A', 'chunk A 0-1', 'caughtUp A'],
    thenPane: 'B',
    expectedAfter: ['opened B', 'chunk B 0-1', 'caughtUp B'],
  },
]

const stateOn = (name: 'A' | 'B') =>
  machineStateWith([agentRow({ claudeSession: Option.some(idOf(name)) })])

const words = (events: readonly TranscriptEvent[], lineBytes: number) => {
  const joined: {
    s: string
    from: number
    to: number
    omit: string
  }[] = []
  const out: (string | (typeof joined)[number])[] = []

  for (const event of events) {
    if (event._tag === 'TranscriptOpened') out.push(`opened ${nameOf(event.session)}`)
    if (event._tag === 'TranscriptCaughtUp') out.push(`caughtUp ${nameOf(event.session)}`)
    if (event._tag === 'TranscriptChunk') {
      const last = out[out.length - 1]
      const from = event.offset / lineBytes
      const to = event.nextOffset / lineBytes
      const omitted = event.messages.find((message) => message._tag === 'Omitted')
      const omit =
        omitted === undefined
          ? ''
          : omitted.offset === 0
            ? ` omit ${to}`
            : ` omit ${from}-${to}`

      if (typeof last === 'object' && last.to === from && last.s === nameOf(event.session)) {
        last.to = to
      } else {
        out.push({ s: nameOf(event.session), from, to, omit })
      }
    }
  }

  return out.map((item) =>
    typeof item === 'string'
      ? item
      : `chunk ${item.s} ${item.from}-${item.to}${item.omit}`,
  )
}

const runCase = (root: string, followCase: FollowCase) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const folder = `${root}/projects/${PROJECT}`
    const line = followCase.big ? BIG_LINE : LINE
    const lineBytes = followCase.big ? BIG_LINE_BYTES : LINE_BYTES
    const tail = followCase.whole ? Option.none() : Option.some(followCase.big ? BIG_TAIL : TAIL)

    yield* fileSystem.remove(root, { recursive: true, force: true })
    yield* fileSystem.makeDirectory(folder, { recursive: true })

    for (const name of ['A', 'B'] as const) {
      const count = followCase.lines[name] ?? 0

      if (count > 0) {
        yield* fileSystem.writeFileString(`${folder}/${idOf(name)}.jsonl`, line.repeat(count))
      }
    }

    const state = yield* SubscriptionRef.make(stateOn(followCase.pane))
    const context = yield* Layer.build(
      Layer.provide(AgentDaemon.transcriptStreamingAt([root]), [
        MachineStateSync.layerTest(state),
        ClaudeSessionFiles.layerTest(),
      ]),
    )
    const streams = Context.get(context, TranscriptStreams)
    const events = yield* Queue.unbounded<TranscriptEvent>()
    const from = followCase.from
      ? Option.some(
          new TranscriptPosition({
            session: idOf(followCase.from[0]),
            offset: TranscriptOffset.make(followCase.from[1] * lineBytes),
          }),
        )
      : Option.none()

    yield* streams.follow(new PaneTranscript({ pane: PANE }), from, tail).pipe(
      Stream.runForEach((event) => Queue.offer(events, event)),
      Effect.forkScoped,
    )

    const untilCaughtUp = (session: 'A' | 'B') =>
      Effect.gen(function* () {
        const seen: TranscriptEvent[] = []

        for (;;) {
          const event = yield* Queue.take(events)

          seen.push(event)
          if (event._tag === 'TranscriptCaughtUp' && event.session === idOf(session)) return seen
        }
      }).pipe(Effect.timeoutOption(SETTLE_TIMEOUT))

    const first = yield* untilCaughtUp(followCase.pane)
    const wordsOf = (events: readonly TranscriptEvent[]) => words(events, lineBytes)
    const firstWords = Option.match(first, { onNone: () => ['timed out'], onSome: wordsOf })
    const problems: string[] = []

    if (JSON.stringify(firstWords) !== JSON.stringify(followCase.expected)) {
      problems.push(
        `${followCase.name}: the code follows ${JSON.stringify(firstWords)}, the model ${JSON.stringify(followCase.expected)}`,
      )
    }

    if (followCase.thenPane !== undefined) {
      yield* SubscriptionRef.set(state, stateOn(followCase.thenPane))
      const after = yield* untilCaughtUp(followCase.thenPane)
      const afterWords = Option.match(after, { onNone: () => ['timed out'], onSome: wordsOf })

      if (JSON.stringify(afterWords) !== JSON.stringify(followCase.expectedAfter)) {
        problems.push(
          `${followCase.name}: after the change the code follows ${JSON.stringify(afterWords)}, the model ${JSON.stringify(followCase.expectedAfter)}`,
        )
      }
    }

    return problems
  }).pipe(Effect.scoped)

export const followDisagreements = (root: string) =>
  Effect.forEach(CASES, (followCase) => runCase(root, followCase)).pipe(
    Effect.map((problems) => ({ cases: CASES.length, problems: problems.flat() })),
    Effect.provide(Layer.mergeAll(BunFileSystem.layer, Path.layer)),
    Effect.runPromise,
  )
