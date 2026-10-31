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

import { FileWatch } from '@crook/claude/FileWatch'
import type { TranscriptFile } from '@crook/claude/TranscriptLocator'
import { parseLine } from '@crook/claude/TranscriptParser'
import { type ClaudeSessionId, TranscriptOffset } from '@crook/domain/Ids'
import {
  CHUNK_READ_LIMIT,
  TranscriptCaughtUp,
  TranscriptChunk,
  type TranscriptTailBytes,
} from '@crook/domain/Transcript'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'

interface TailState {
  readonly consumed: number
  readonly pending: Uint8Array
}

interface CompleteLine {
  readonly offset: number
  readonly bytes: Uint8Array
}

export type TailEvent = TranscriptChunk | TranscriptCaughtUp

export type LineParser = (
  bytes: Uint8Array,
  offset: TranscriptOffset,
) => readonly TranscriptMessage[]

export type TailError =
  | TranscriptUnreadable
  | TranscriptOffsetBeyondEnd
  | TranscriptOffsetMidLine
  | TranscriptShrank

export const NEWLINE = 0x0a
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

const completeLines = (complete: Uint8Array, start: number): readonly CompleteLine[] =>
  Arr.unfold(0, (from) =>
    Option.map(
      Option.liftPredicate(complete.indexOf(NEWLINE, from), (end) => end >= 0),
      (end) => [{ offset: start + from, bytes: complete.subarray(from, end) }, end + 1] as const,
    ),
  )

const messagesParsedWith = (
  parse: LineParser,
  complete: Uint8Array,
  start: number,
): readonly TranscriptMessage[] =>
  Arr.flatMap(completeLines(complete, start), (line) =>
    parse(line.bytes, TranscriptOffset.make(line.offset)),
  )

export const messagesIn = (complete: Uint8Array, start: number): readonly TranscriptMessage[] =>
  messagesParsedWith(parseLine, complete, start)

const chunkOf = (
  parse: LineParser,
  session: ClaudeSessionId,
  start: number,
  complete: Uint8Array,
): TranscriptChunk =>
  new TranscriptChunk({
    session,
    offset: TranscriptOffset.make(start),
    nextOffset: TranscriptOffset.make(start + complete.length),
    messages: messagesParsedWith(parse, complete, start),
  })

const unreadableFile = (file: TranscriptFile) => (cause: PlatformError) =>
  new TranscriptUnreadable({ path: file.path, cause })

export const openWithSize = Effect.fn('TranscriptTail.openWithSize')(function* (
  fileSystem: FileSystem.FileSystem,
  file: TranscriptFile,
) {
  const unreadable = unreadableFile(file)
  const handle = yield* fileSystem.open(file.path, { flag: 'r' }).pipe(Effect.mapError(unreadable))
  const info = yield* handle.stat.pipe(Effect.mapError(unreadable))

  return { handle, size: Number(info.size) }
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

const lineStartBefore = (
  handle: FileSystem.File,
  position: number,
): Effect.Effect<number, PlatformError> => {
  const windowStart = Math.max(0, position - TAIL_READ_SIZE)

  return handle.readAlloc(position - windowStart, { position: BigInt(windowStart) }).pipe(
    Effect.flatMap((read) =>
      pipe(
        read,
        Option.map((bytes) => bytes.lastIndexOf(NEWLINE)),
        Option.filter((newline) => newline >= 0),
        Option.match({
          onSome: (newline) => Effect.succeed(windowStart + newline + 1),
          onNone: () =>
            windowStart === 0 ? Effect.succeed(0) : lineStartBefore(handle, windowStart),
        }),
      ),
    ),
  )
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const fileWatch = yield* FileWatch

  const open = Effect.fn('TranscriptTail.open')(function* (
    file: TranscriptFile,
    from: TranscriptOffset,
    parse: LineParser,
  ) {
    const unreadable = unreadableFile(file)
    const { handle, size: sizeAtOpen } = yield* openWithSize(fileSystem, file)

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
          : Effect.succeed(size),
      ),
    )

    const readUpTo = Effect.fn('TranscriptTail.readUpTo')(function* (size: number) {
      const current = yield* Ref.get(state)
      const position = current.consumed + current.pending.length
      const read = yield* Option.match(
        Option.liftPredicate(size - position, (unread) => unread > 0),
        {
          onNone: () => Effect.succeedNone,
          onSome: (unread) =>
            handle
              .readAlloc(Math.min(unread, CHUNK_READ_LIMIT), { position: BigInt(position) })
              .pipe(Effect.mapError(unreadable)),
        },
      )

      return yield* Option.match(read, {
        onNone: () => Effect.succeed([[], Option.none<void>()] as const),
        onSome: (bytes) => {
          const [complete, next] = afterRead(current, bytes)

          return Ref.set(state, next).pipe(
            Effect.as([
              Option.match(complete, {
                onNone: () => [],
                onSome: ({ start, complete: lines }) => [chunkOf(parse, session, start, lines)],
              }),
              Option.some<void>(undefined),
            ] as const),
          )
        },
      })
    })

    const available = Stream.unwrap(
      Effect.map(checkSize, (size) =>
        Stream.paginate<void, TranscriptChunk, TailError>(undefined, () => readUpTo(size)),
      ),
    )

    const caughtUp = Effect.map(
      Ref.get(state),
      (current) =>
        new TranscriptCaughtUp({ session, offset: TranscriptOffset.make(current.consumed) }),
    )

    return { available, caughtUp }
  })

  const drainWith = (file: TranscriptFile, from: TranscriptOffset, parse: LineParser) =>
    Stream.unwrap(Effect.map(open(file, from, parse), ({ available }) => available))

  const followWith = (file: TranscriptFile, from: TranscriptOffset, parse: LineParser) =>
    Stream.unwrap(
      Effect.map(open(file, from, parse), ({ available, caughtUp }) =>
        fileWatch.watchReady(file.path).pipe(
          Stream.mapError(unreadableFile(file)),
          Stream.buffer({ capacity: 1, strategy: 'sliding' }),
          Stream.zipWithIndex,
          Stream.flatMap(([, index]): Stream.Stream<TailEvent, TailError> =>
            index === 0 ? Stream.concat(available, Stream.fromEffect(caughtUp)) : available,
          ),
        ),
      ),
    )

  const tailStart = Effect.fn('TranscriptTail.tailStart')(function* (
    file: TranscriptFile,
    bytes: TranscriptTailBytes,
  ) {
    const { handle, size } = yield* openWithSize(fileSystem, file)
    const start =
      size <= bytes
        ? 0
        : yield* lineStartBefore(handle, size - bytes).pipe(Effect.mapError(unreadableFile(file)))

    return TranscriptOffset.make(start)
  }, Effect.scoped)

  const drain = (file: TranscriptFile, from: TranscriptOffset) => drainWith(file, from, parseLine)

  const follow = (file: TranscriptFile, from: TranscriptOffset) => followWith(file, from, parseLine)

  return TranscriptTail.of({ follow, drain, followWith, drainWith, tailStart })
})

export class TranscriptTail extends Context.Service<
  TranscriptTail,
  {
    readonly follow: (
      file: TranscriptFile,
      from: TranscriptOffset,
    ) => Stream.Stream<TailEvent, TailError>
    readonly drain: (
      file: TranscriptFile,
      from: TranscriptOffset,
    ) => Stream.Stream<TranscriptChunk, TailError>
    readonly followWith: (
      file: TranscriptFile,
      from: TranscriptOffset,
      parse: LineParser,
    ) => Stream.Stream<TailEvent, TailError>
    readonly drainWith: (
      file: TranscriptFile,
      from: TranscriptOffset,
      parse: LineParser,
    ) => Stream.Stream<TranscriptChunk, TailError>
    readonly tailStart: (
      file: TranscriptFile,
      bytes: TranscriptTailBytes,
    ) => Effect.Effect<TranscriptOffset, TranscriptUnreadable>
  }
>()('@crook/claude/TranscriptTail') {
  static readonly layer = Layer.effect(this, make)
}
