import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { watchReady } from '@crook/claude/FileWatch'
import type { TranscriptFile } from '@crook/claude/TranscriptLocator'
import { parseLine } from '@crook/claude/TranscriptParser'
import { type ClaudeSessionId, TranscriptOffset } from '@crook/domain/Ids'
import { TranscriptChunk } from '@crook/domain/Transcript'

interface TailState {
  readonly consumed: number
  readonly pending: Uint8Array
}

interface CompleteLine {
  readonly offset: number
  readonly text: string
}

export type TailError =
  | TranscriptUnreadable
  | TranscriptOffsetBeyondEnd
  | TranscriptOffsetMidLine
  | TranscriptShrank

const NEWLINE = 0x0a

export const TAIL_READ_SIZE = 64 * 1024

export class TranscriptUnreadable extends Schema.TaggedError<TranscriptUnreadable>()(
  'TranscriptUnreadable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read the Claude transcript ${this.path}. Check that crook runs as the same user as Claude and that the file is still there.`
  }
}

export class TranscriptOffsetBeyondEnd extends Schema.TaggedError<TranscriptOffsetBeyondEnd>()(
  'TranscriptOffsetBeyondEnd',
  { path: Schema.String, offset: Schema.Int, size: Schema.Int },
) {
  override get message(): string {
    return `Asked to resume ${this.path} at byte ${this.offset}, but the file holds only ${this.size} bytes. The offset belongs to another file: watch the transcript again from the start.`
  }
}

export class TranscriptOffsetMidLine extends Schema.TaggedError<TranscriptOffsetMidLine>()(
  'TranscriptOffsetMidLine',
  { path: Schema.String, offset: Schema.Int },
) {
  override get message(): string {
    return `Asked to resume ${this.path} at byte ${this.offset}, which is not the start of a line. Offsets crook hands out always are, so this one belongs to another file: watch the transcript again from the start.`
  }
}

export class TranscriptShrank extends Schema.TaggedError<TranscriptShrank>()('TranscriptShrank', {
  path: Schema.String,
  consumed: Schema.Int,
  size: Schema.Int,
}) {
  override get message(): string {
    return `The Claude transcript ${this.path} shrank to ${this.size} bytes after crook had read ${this.consumed}. Claude only ever appends, so something else rewrote the file: watch the transcript again from the start.`
  }
}

const joined = (left: Uint8Array, right: Uint8Array) => {
  const both = new Uint8Array(left.length + right.length)

  both.set(left)
  both.set(right, left.length)

  return both
}

const decoder = new TextDecoder()

const completeLines = (complete: Uint8Array, start: number): readonly CompleteLine[] =>
  Arr.unfold(0, (from) =>
    Option.map(
      Option.liftPredicate(complete.indexOf(NEWLINE, from), (end) => end >= 0),
      (end) =>
        [
          { offset: start + from, text: decoder.decode(complete.subarray(from, end)) },
          end + 1,
        ] as const,
    ),
  )

const chunkOf = (session: ClaudeSessionId, start: number, complete: Uint8Array): TranscriptChunk =>
  new TranscriptChunk({
    session,
    offset: TranscriptOffset.make(start),
    nextOffset: TranscriptOffset.make(start + complete.length),
    messages: pipe(
      completeLines(complete, start),
      Arr.filter((line) => line.text.trim().length > 0),
      Arr.flatMap((line) => parseLine(line.text, TranscriptOffset.make(line.offset))),
    ),
  })

const afterRead = (
  state: TailState,
  bytes: Uint8Array,
): readonly [
  Option.Option<{ readonly start: number; readonly complete: Uint8Array }>,
  TailState,
] => {
  const combined = joined(state.pending, bytes)
  const lastNewline = combined.lastIndexOf(NEWLINE)

  return lastNewline < 0
    ? [Option.none(), { consumed: state.consumed, pending: combined }]
    : [
        Option.some({ start: state.consumed, complete: combined.subarray(0, lastNewline + 1) }),
        {
          consumed: state.consumed + lastNewline + 1,
          pending: combined.slice(lastNewline + 1),
        },
      ]
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem

  const open = Effect.fn('TranscriptTail.open')(function* (
    file: TranscriptFile,
    from: TranscriptOffset,
  ) {
    const unreadable = (cause: PlatformError) =>
      new TranscriptUnreadable({ path: file.path, cause })
    const handle = yield* fileSystem
      .open(file.path, { flag: 'r' })
      .pipe(Effect.mapError(unreadable))
    const sizeAtOpen = Number((yield* handle.stat.pipe(Effect.mapError(unreadable))).size)

    if (from > sizeAtOpen) {
      return yield* new TranscriptOffsetBeyondEnd({
        path: file.path,
        offset: from,
        size: sizeAtOpen,
      })
    }

    const before = yield* Option.match(
      Option.liftPredicate(from, (offset) => offset > 0),
      {
        onNone: () => Effect.succeed(Option.none<Uint8Array>()),
        onSome: (offset) =>
          handle.readAlloc(1, { position: BigInt(offset - 1) }).pipe(Effect.mapError(unreadable)),
      },
    )

    if (Option.exists(before, (byte) => byte[0] !== NEWLINE)) {
      return yield* new TranscriptOffsetMidLine({ path: file.path, offset: from })
    }

    const state = yield* Ref.make<TailState>({ consumed: from, pending: new Uint8Array(0) })
    const session = file.session

    const checkSize = Effect.zipWith(
      Ref.get(state),
      handle.stat.pipe(Effect.mapError(unreadable)),
      (current, info) => ({
        read: current.consumed + current.pending.length,
        size: Number(info.size),
      }),
    ).pipe(
      Effect.flatMap(({ read, size }) =>
        size < read
          ? Effect.fail(new TranscriptShrank({ path: file.path, consumed: read, size }))
          : Effect.void,
      ),
    )

    const readOnce = Effect.gen(function* () {
      const current = yield* Ref.get(state)
      const read = yield* handle
        .readAlloc(TAIL_READ_SIZE, {
          position: BigInt(current.consumed + current.pending.length),
        })
        .pipe(Effect.mapError(unreadable))

      return yield* Option.match(read, {
        onNone: () => Effect.succeed([[], Option.none<void>()] as const),
        onSome: (bytes) => {
          const [complete, next] = afterRead(current, bytes)

          return Ref.set(state, next).pipe(
            Effect.as([
              Option.match(complete, {
                onNone: () => [],
                onSome: ({ start, complete: lines }) => [chunkOf(session, start, lines)],
              }),
              Option.some<void>(undefined),
            ] as const),
          )
        },
      })
    })

    const available = Stream.unwrap(
      Effect.as(
        checkSize,
        Stream.paginate<void, TranscriptChunk, TailError>(undefined, () => readOnce),
      ),
    )

    return { available, unreadable }
  })

  const drain = (file: TranscriptFile, from: TranscriptOffset) =>
    Stream.unwrap(Effect.map(open(file, from), ({ available }) => available))

  const follow = (file: TranscriptFile, from: TranscriptOffset) =>
    Stream.unwrap(
      Effect.map(open(file, from), ({ available, unreadable }) =>
        watchReady(fileSystem, file.path).pipe(
          Stream.mapError(unreadable),
          Stream.buffer({ capacity: 1, strategy: 'sliding' }),
          Stream.flatMap(() => available),
        ),
      ),
    )

  return TranscriptTail.of({ follow, drain })
})

export class TranscriptTail extends Context.Service<
  TranscriptTail,
  {
    readonly follow: (
      file: TranscriptFile,
      from: TranscriptOffset,
    ) => Stream.Stream<TranscriptChunk, TailError>
    readonly drain: (
      file: TranscriptFile,
      from: TranscriptOffset,
    ) => Stream.Stream<TranscriptChunk, TailError>
  }
>()('@crook/claude/TranscriptTail') {
  static readonly layer = Layer.effect(this, make)
}
