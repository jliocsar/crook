import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as Context from 'effect/Context'

import { ClaudeSessionId, MachineId, PaneId, TranscriptOffset } from '@crook/domain/Ids'
import {
  CHUNK_READ_LIMIT,
  PaneTranscript,
  TranscriptCaughtUp,
  TranscriptChunk,
  type TranscriptEvent,
  TranscriptOpened,
  TranscriptPosition,
} from '@crook/domain/Transcript'
import { OmittedLines, UnrecognizedEntry } from '@crook/domain/TranscriptMessage'
import { TranscriptRelay } from '@crook/hub/TranscriptRelay'
import {
  EMPTY_BATCH,
  type TranscriptBatch,
  batchWith,
  isCaughtUp,
  isFull,
  updatesOf,
} from '@crook/protocol/TranscriptBatch'
import {
  TranscriptOutOfStep,
  TranscriptReadFailed,
  TranscriptResumeRejected,
  type TranscriptUpdate,
  TranscriptWatchFailed,
} from '@crook/protocol/Transcripts'
import {
  EMPTY_TRANSCRIPT,
  type TranscriptView,
  applyTranscriptEvent,
  catchingUpFrom,
  failedWith,
  isOpened,
  isShowable,
  resumeOf,
} from '@crook/web/chat/TranscriptState'

import type { TraceState } from './TraceReader'

const MACHINE = MachineId.make('laptop')
const SOURCE = new PaneTranscript({ pane: PaneId.make('w1:p1') })
const SESSION_IDS: Record<string, ClaudeSessionId> = {
  A: ClaudeSessionId.make('aaaaaaaa-0000-4000-8000-000000000000'),
  B: ClaudeSessionId.make('bbbbbbbb-0000-4000-8000-000000000000'),
}
const SESSION_NAMES: Record<string, string> = {
  [SESSION_IDS['A'] as string]: 'A',
  [SESSION_IDS['B'] as string]: 'B',
}
const STEP_TIMEOUT = '2 seconds'
const WATCH_REGISTERS = '5 millis'

export class Disagreement extends Error {}

const isNone = (value: any) => typeof value === 'object' && value !== null && value.model === 'NONE'

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

const canonical = (value: any): any => {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  }

  return value
}

const modelEvent = (update: any) => {
  const { e: _epoch, ...rest } = update

  return canonical(rest)
}

export const replay = (states: readonly TraceState[], mailboxCapacity: number) =>
  Effect.gen(function* () {
    const relay = yield* TranscriptRelay
    const lineBytes = CHUNK_READ_LIMIT / mailboxCapacity

    const toReal = (update: any): TranscriptUpdate => {
      const session = SESSION_IDS[update.s] as ClaudeSessionId

      if (update.t === 'opened') return new TranscriptOpened({ session })
      if (update.t === 'caughtUp') {
        return new TranscriptCaughtUp({ session, offset: TranscriptOffset.make(0) })
      }
      if (update.t === 'failed') {
        return new TranscriptWatchFailed({
          failure:
            update.kind === 'rejected'
              ? new TranscriptResumeRejected({ detail: 'replay' })
              : new TranscriptReadFailed({ detail: 'replay' }),
        })
      }

      const first = update.omit > 0 ? update.omit : update.from
      const omitted =
        update.omit > 0
          ? [
              new OmittedLines({
                offset: TranscriptOffset.make(0),
                byteLength: update.omit * lineBytes,
              }),
            ]
          : []
      const lines = Arr.makeBy(
        Math.max(update.to - first, 1),
        (index) =>
          new UnrecognizedEntry({
            offset: TranscriptOffset.make((first + index) * lineBytes),
            entryType: 'line',
          }),
      )

      return new TranscriptChunk({
        session,
        offset: TranscriptOffset.make(update.from * lineBytes),
        nextOffset: TranscriptOffset.make(update.to * lineBytes),
        messages: update.to > first ? [...omitted, ...lines] : omitted,
      })
    }

    const fromReal = (update: TranscriptUpdate): any => {
      switch (update._tag) {
        case 'TranscriptOpened':
          return { s: SESSION_NAMES[update.session], t: 'opened' }
        case 'TranscriptCaughtUp':
          return { s: SESSION_NAMES[update.session], t: 'caughtUp' }
        case 'TranscriptWatchFailed':
          return {
            kind: update.failure._tag === 'TranscriptResumeRejected' ? 'rejected' : 'read',
            t: 'failed',
          }
        case 'TranscriptChunk': {
          const omitted = update.messages.find((message) => message._tag === 'Omitted')

          return {
            from: update.offset / lineBytes,
            omit: omitted === undefined ? 0 : (omitted as OmittedLines).byteLength / lineBytes,
            s: SESSION_NAMES[update.session],
            t: 'chunk',
            to: update.nextOffset / lineBytes,
          }
        }
        default:
          return { t: 'other' }
      }
    }

    const positionOfReal = (position: Option.Option<TranscriptPosition>): any =>
      Option.match(position, {
        onNone: () => ({ model: 'NONE' }),
        onSome: (at) => ({ off: at.offset / lineBytes, s: SESSION_NAMES[at.session] }),
      })

    const realView = (view: TranscriptView) => ({
      catching: view.catchingUp,
      failed: Option.isSome(view.failure),
      lines: view.lines.map((line) => {
        const session = SESSION_NAMES[line.session] as string

        if (line._tag === 'SessionCleared') return ['cleared', session, 0]

        return line.message._tag === 'Omitted'
          ? ['omitted', session, line.message.byteLength / lineBytes]
          : ['line', session, line.message.offset / lineBytes]
      }),
      position: positionOfReal(view.position),
    })

    const modelView = (view: any) => ({
      catching: view.catching,
      failed: view.failed,
      lines: view.lines,
      position: isNone(view.position) ? { model: 'NONE' } : canonical(view.position),
    })

    let view = catchingUpFrom(EMPTY_TRANSCRIPT, true)
    let cached: TranscriptView | undefined
    let outbox: TranscriptBatch = EMPTY_BATCH
    let live: readonly TranscriptUpdate[] = []
    let stale: readonly TranscriptUpdate[] = []
    let wire: readonly (TranscriptEvent | TranscriptUpdate)[] = []
    let watchScope = yield* Scope.make()
    let pull: Effect.Effect<readonly TranscriptEvent[], any> = Effect.succeed([])
    let watchId: any

    const currentDemand = Effect.map(
      Stream.runHead(relay.demands(MACHINE)),
      Option.match({ onNone: () => [] as any[], onSome: (demand) => [...demand.watches] }),
    )

    const openWatch = (from: Option.Option<TranscriptPosition>) =>
      Effect.gen(function* () {
        yield* Scope.close(watchScope, Exit.void)
        watchScope = yield* Scope.make()
        pull = yield* Stream.toPull(relay.watch(MACHINE, SOURCE, from, Option.none())).pipe(
          Scope.provide(watchScope),
        )
        yield* Effect.timeoutOption(pull, WATCH_REGISTERS)
        const watches = yield* currentDemand

        watchId = watches[0]?.id
        wire = []
        live = []
        stale = []
        outbox = EMPTY_BATCH
      })

    const resumeWith = (current: TranscriptView) =>
      Effect.gen(function* () {
        const from = resumeOf(current, Option.none()).from

        view = catchingUpFrom(current, true)
        yield* openWatch(from)
      })

    const publishOne = (update: TranscriptUpdate) =>
      relay.publish(MACHINE, watchId, [update]).pipe(
        Effect.timeoutOrElse({
          duration: STEP_TIMEOUT,
          orElse: () =>
            Effect.die(new Disagreement('the code blocked on a publish the model delivers')),
        }),
        Effect.exit,
      )

    yield* openWatch(Option.none())

    for (let index = 1; index < states.length; index += 1) {
      const before = (states[index - 1] as TraceState).vars
      const after = (states[index] as TraceState).vars
      const action = (states[index] as TraceState).action
      const fail = (detail: string) =>
        Effect.die(new Disagreement(`step ${index + 1} ${action}: ${detail}`))

      const who =
        !same(before['call'], after['call']) || isNone(before['stale']) ? 'live' : 'stale'
      const takeUpdate = () => {
        const left = who === 'live' ? live : stale
        const head = left[0] as TranscriptUpdate

        if (who === 'live') live = left.slice(1)
        else stale = left.slice(1)

        return head
      }

      switch (action) {
        case 'TapOffers': {
          const update = (before['fiber'].queued as any[])[0]

          if (update.t !== 'failed' && isFull(outbox)) {
            yield* fail('the code refuses this offer: its mailbox is full')
          }
          outbox = batchWith(outbox, toReal(update))
          break
        }
        case 'Publishes': {
          if (!isCaughtUp(outbox)) yield* fail('the code would hold this batch back')
          live = updatesOf(outbox)
          outbox = EMPTY_BATCH
          if (!same(live.map(fromReal), (after['call'] as any[]).map(modelEvent))) {
            yield* fail(
              `the code publishes ${JSON.stringify(live.map(fromReal))}, the model ${JSON.stringify((after['call'] as any[]).map(modelEvent))}`,
            )
          }
          break
        }
        case 'AgentConnectionDrops': {
          if (!isNone(before['call'])) stale = live
          live = []
          outbox = EMPTY_BATCH
          break
        }
        case 'DemandStartsWatch': {
          outbox = EMPTY_BATCH
          live = []
          const watches = yield* currentDemand
          const from = watches[0]?.from

          if (!same(positionOfReal(from), canonical(after['fiber'].at))) {
            yield* fail(
              `the demand starts from ${JSON.stringify(positionOfReal(from))}, the model from ${JSON.stringify(after['fiber'].at)}`,
            )
          }
          break
        }
        case 'HubDropsOpen':
        case 'HubForwardsOpen':
        case 'HubForwardsChunk':
        case 'HubForwardsCaughtUp':
        case 'HubDropsCaughtUp': {
          const exit = yield* publishOne(takeUpdate())

          if (Exit.isFailure(exit)) yield* fail('the code refuses what the model accepts')
          break
        }
        case 'HubRefusesChunk': {
          const exit = yield* publishOne(takeUpdate())
          const expected = canonical(after['watcher'].delivered)

          if (Exit.isSuccess(exit)) yield* fail('the code accepts a chunk the model refuses')
          if (Exit.isFailure(exit)) {
            const found = exit.cause.reasons.flatMap((reason: any) =>
              reason._tag === 'Fail' ? [reason.error] : [],
            )[0]

            if (!(found instanceof TranscriptOutOfStep)) {
              yield* fail('the code refused with something other than TranscriptOutOfStep')
            } else if (!same(positionOfReal(found.expected), expected)) {
              yield* fail(
                `the code expects ${JSON.stringify(positionOfReal(found.expected))}, the model ${JSON.stringify(expected)}`,
              )
            }
          }
          if (who === 'live') {
            live = []
            outbox = EMPTY_BATCH
          } else stale = []
          break
        }
        case 'HubFailsWatch': {
          const exit = yield* publishOne(takeUpdate())

          if (Exit.isFailure(exit)) yield* fail('the code refuses a failure')
          live = []
          stale = []
          break
        }
        case 'HubDropsCallOfGoneWatch': {
          const left = who === 'live' ? live : stale

          if (left.length > 0) {
            const exit = yield* publishOne(left[0] as TranscriptUpdate)

            if (Exit.isFailure(exit)) yield* fail('the code refuses a call on a gone watch')
          }
          if (who === 'live') live = []
          else stale = []
          break
        }
        case 'HubSeesDeadSocket': {
          stale = []
          break
        }
        case 'HubSends': {
          const expected = (after['wire'] as any[]).map(modelEvent)
          const hasFailure = expected.some((update) => update.t === 'failed')
          const events = (yield* pull.pipe(
            Effect.catch((failure: any) => Effect.succeed([failure])),
          )) as readonly any[]
          const isFailureAlone = events.length === 1 && events[0]?._tag !== undefined && !('session' in events[0])
          const received: any[] = isFailureAlone ? [] : [...events]
          const failure: any = isFailureAlone
            ? events[0]
            : hasFailure
              ? yield* pull.pipe(Effect.flip)
              : undefined
          const mapped = [
            ...received.map(fromReal),
            ...(failure === undefined
              ? []
              : [
                  {
                    kind: failure._tag === 'TranscriptResumeRejected' ? 'rejected' : 'read',
                    t: 'failed',
                  },
                ]),
          ]

          if (!same(mapped, expected)) {
            yield* fail(
              `the phone gets ${JSON.stringify(mapped)}, the model ${JSON.stringify(expected)}`,
            )
          }
          wire = [
            ...received,
            ...(failure === undefined ? [] : [new TranscriptWatchFailed({ failure })]),
          ]
          break
        }
        case 'PhoneApplies': {
          view = applyTranscriptEvent(view, wire[0] as TranscriptEvent)
          wire = wire.slice(1)
          if (isShowable(view)) cached = view
          break
        }
        case 'PhoneSeesFailure': {
          const failure = (wire[0] as TranscriptWatchFailed).failure

          wire = []
          if (failure._tag === 'TranscriptResumeRejected' && isOpened(view)) {
            yield* resumeWith(EMPTY_TRANSCRIPT)
          } else {
            view = failedWith(view, failure)
          }
          break
        }
        case 'PhoneConnectionDrops': {
          yield* Scope.close(watchScope, Exit.void)
          watchScope = yield* Scope.make()
          wire = []
          live = []
          stale = []
          outbox = EMPTY_BATCH
          break
        }
        case 'PhoneReconnects':
        case 'UserPressesTryAgain': {
          yield* resumeWith(view)
          break
        }
        case 'ChatReopens': {
          yield* resumeWith(cached ?? EMPTY_TRANSCRIPT)
          break
        }
        default:
          break
      }

      if (!same(canonical(realView(view)), canonical(modelView(after['view'])))) {
        yield* fail(
          `the view is ${JSON.stringify(realView(view))}, the model's ${JSON.stringify(modelView(after['view']))}`,
        )
      }

      if (!same(updatesOf(outbox).map(fromReal), flatOutbox(after['fiber'].outbox).map(modelEvent))) {
        yield* fail(
          `the outbox holds ${JSON.stringify(updatesOf(outbox).map(fromReal))}, the model's ${JSON.stringify(flatOutbox(after['fiber'].outbox))}`,
        )
      }

      const heldByModel = flatOutbox(after['fiber'].outbox)
        .filter((update) => update.t === 'chunk')
        .reduce((held, chunk) => held + chunk.to - chunk.from - chunk.omit, 0)

      if (isFull(outbox) !== heldByModel >= mailboxCapacity) {
        yield* fail(
          `the code says the outbox is ${isFull(outbox) ? 'full' : 'not full'} at ${heldByModel} lines, of ${mailboxCapacity}`,
        )
      }

      const cachedModel = after['cached']

      if (
        !same(
          cached === undefined ? { model: 'NONE' } : canonical(realView(cached)),
          isNone(cachedModel) ? { model: 'NONE' } : canonical(modelView(cachedModel)),
        )
      ) {
        yield* fail("the cache holds something else than the model's")
      }

      const demand = yield* currentDemand

      if (after['watcher'].alive) {
        const delivered = demand[0]?.from

        if (
          delivered === undefined ||
          !same(positionOfReal(delivered), canonical(after['watcher'].delivered))
        ) {
          yield* fail(
            `the relay's position is ${delivered === undefined ? 'gone' : JSON.stringify(positionOfReal(delivered))}, the model's ${JSON.stringify(after['watcher'].delivered)}`,
          )
        }
      } else if (demand.length > 0) {
        yield* fail('the relay still holds a watch the model removed')
      }
    }

    yield* Scope.close(watchScope, Exit.void)

    return { steps: states.length, lines: realView(view).lines, view: realView(view) }
  })

const flatOutbox = (batch: any): any[] => [
  ...(batch.sessions as any[]).flatMap((entry) => [
    ...(isNone(entry.opened) ? [] : [entry.opened]),
    ...(entry.chunks as any[]),
    ...(isNone(entry.caughtUp) ? [] : [entry.caughtUp]),
  ]),
  ...(isNone(batch.failed) ? [] : [batch.failed]),
]

export const replayOnce = (states: readonly TraceState[], mailboxCapacity: number) =>
  replay(states, mailboxCapacity).pipe(
    Effect.provide(TranscriptRelay.layer),
    Effect.scoped,
    Effect.runPromise,
  )
