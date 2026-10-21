import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'

import type { TranscriptFile } from '@crook/claude/TranscriptLocator'
import { parseLine } from '@crook/claude/TranscriptParser'
import { TAIL_READ_SIZE, TranscriptUnreadable } from '@crook/claude/TranscriptTail'
import { TranscriptOffset } from '@crook/domain/Ids'
import type { ToolUseBlock, TranscriptMessage, UserMessage } from '@crook/domain/TranscriptMessage'

interface ByteLine {
  readonly offset: number
  readonly bytes: Uint8Array
}

const NEWLINE = 0x0a

export const CODEMODE_RUN_TOOL = 'mcp__codemode__run'

const isHumanPrompt = (message: UserMessage) =>
  !message.isMeta &&
  Arr.some(message.blocks, (block) =>
    Match.value(block).pipe(
      Match.tag('Text', () => true),
      Match.orElse(() => false),
    ),
  ) &&
  !Arr.some(message.blocks, (block) =>
    Match.value(block).pipe(
      Match.tag('ToolResult', () => true),
      Match.orElse(() => false),
    ),
  )

const startsTurn = (message: TranscriptMessage) =>
  Match.value(message).pipe(
    Match.tag('User', isHumanPrompt),
    Match.orElse(() => false),
  )

const toolUsesOf = (message: TranscriptMessage): readonly ToolUseBlock[] =>
  Match.value(message).pipe(
    Match.tag('Assistant', (assistant) =>
      Arr.flatMap(assistant.blocks, (block) =>
        Match.value(block).pipe(
          Match.tag('ToolUse', (toolUse) => [toolUse]),
          Match.orElse(() => []),
        ),
      ),
    ),
    Match.orElse(() => []),
  )

const toolResultIdsOf = (message: TranscriptMessage): readonly string[] =>
  Match.value(message).pipe(
    Match.tag('User', (user) =>
      Arr.flatMap(user.blocks, (block) =>
        Match.value(block).pipe(
          Match.tag('ToolResult', (result) => [result.toolUseId]),
          Match.orElse(() => []),
        ),
      ),
    ),
    Match.orElse(() => []),
  )

export const latestTurn = (messages: readonly TranscriptMessage[]): readonly TranscriptMessage[] =>
  Option.match(Arr.findLastIndex(messages, startsTurn), {
    onNone: () => messages,
    onSome: (index) => messages.slice(index + 1),
  })

export const isEnoughOfTurn = (messages: readonly TranscriptMessage[]): boolean =>
  Arr.some(
    messages,
    (message) => startsTurn(message) || Arr.isReadonlyArrayNonEmpty(toolUsesOf(message)),
  )

export const firstUnmatchedToolUse = (
  messages: readonly TranscriptMessage[],
): Option.Option<ToolUseBlock> => {
  const turn = latestTurn(messages)
  const answered = Arr.flatMap(turn, toolResultIdsOf)

  return pipe(
    Arr.flatMap(turn, toolUsesOf),
    Arr.findFirst((toolUse) => !Arr.contains(answered, toolUse.id)),
    Option.filter((toolUse) => toolUse.name !== CODEMODE_RUN_TOOL),
  )
}

const newlinesFrom = (bytes: Uint8Array, from: number): readonly number[] =>
  Arr.unfold(bytes.indexOf(NEWLINE, from), (index) =>
    index < 0 ? Option.none() : Option.some([index, bytes.indexOf(NEWLINE, index + 1)] as const),
  )

const completeLines = (bytes: Uint8Array, start: number): readonly ByteLine[] => {
  const firstLine = start === 0 ? 0 : bytes.indexOf(NEWLINE) + 1

  if (start > 0 && firstLine === 0) {
    return []
  }

  const ends = newlinesFrom(bytes, firstLine)

  return ends.map((end, index) => {
    const from = index === 0 ? firstLine : (ends[index - 1] ?? firstLine) + 1

    return { offset: start + from, bytes: bytes.subarray(from, end + 1) }
  })
}

const messagesOf = (bytes: Uint8Array, start: number) =>
  Arr.flatMap(completeLines(bytes, start), (line) =>
    parseLine(line.bytes, TranscriptOffset.make(line.offset)),
  )

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem

  const read = Effect.fn('LastTurn.read')(function* (file: TranscriptFile) {
    const unreadable = (cause: PlatformError) =>
      new TranscriptUnreadable({ path: file.path, cause })
    const handle = yield* fileSystem
      .open(file.path, { flag: 'r' })
      .pipe(Effect.mapError(unreadable))
    const size = Number((yield* handle.stat.pipe(Effect.mapError(unreadable))).size)

    const readWindow = (
      window: number,
    ): Effect.Effect<readonly TranscriptMessage[], TranscriptUnreadable> => {
      const start = Math.max(size - window, 0)

      return handle.readAlloc(size - start, { position: BigInt(start) }).pipe(
        Effect.mapError(unreadable),
        Effect.map((bytesRead) =>
          Option.match(bytesRead, {
            onNone: () => [],
            onSome: (bytes) => messagesOf(bytes, start),
          }),
        ),
        Effect.flatMap((messages) =>
          start === 0 || isEnoughOfTurn(messages)
            ? Effect.succeed(latestTurn(messages))
            : readWindow(window * 2),
        ),
      )
    }

    return yield* readWindow(TAIL_READ_SIZE)
  }, Effect.scoped)

  return LastTurn.of({ read })
})

export class LastTurn extends Context.Service<
  LastTurn,
  {
    readonly read: (
      file: TranscriptFile,
    ) => Effect.Effect<readonly TranscriptMessage[], TranscriptUnreadable>
  }
>()('@crook/claude/LastTurn') {
  static readonly layer = Layer.effect(this, make)
}
