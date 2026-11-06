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
import {
  NEWLINE,
  TAIL_READ_SIZE,
  TranscriptUnreadable,
  messagesIn,
  openWithSize,
} from '@crook/claude/TranscriptTail'
import type { ToolUseBlock, TranscriptMessage, UserMessage } from '@crook/domain/TranscriptMessage'

const CODEMODE_RUN_TOOL = 'mcp__codemode__run'

const opensTurn = (message: UserMessage) =>
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
    Match.tag('User', opensTurn),
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

const latestTurn = (messages: readonly TranscriptMessage[]): readonly TranscriptMessage[] =>
  Option.match(Arr.findLastIndex(messages, startsTurn), {
    onNone: () => messages,
    onSome: (index) => messages.slice(index + 1),
  })

const isEnoughOfTurn = (messages: readonly TranscriptMessage[]): boolean =>
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

const messagesAfterCut = (bytes: Uint8Array, start: number): readonly TranscriptMessage[] =>
  start === 0
    ? messagesIn(bytes, start)
    : Option.match(
        Option.liftPredicate(bytes.indexOf(NEWLINE) + 1, (from) => from > 0),
        {
          onNone: () => [],
          onSome: (from) => messagesIn(bytes.subarray(from), start + from),
        },
      )

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem

  const read = Effect.fn('LastTurn.read')(function* (file: TranscriptFile) {
    const unreadable = (cause: PlatformError) =>
      new TranscriptUnreadable({ path: file.path, cause })
    const { handle, size } = yield* openWithSize(fileSystem, file)

    const readWindow = (
      window: number,
    ): Effect.Effect<readonly TranscriptMessage[], TranscriptUnreadable> => {
      const start = Math.max(size - window, 0)

      return handle.readAlloc(size - start, { position: BigInt(start) }).pipe(
        Effect.mapError(unreadable),
        Effect.map((bytesRead) =>
          Option.match(bytesRead, {
            onNone: () => [],
            onSome: (bytes) => messagesAfterCut(bytes, start),
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
