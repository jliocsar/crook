import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { ClaudeSessionId, TranscriptOffset } from '@crook/domain/Ids'
import {
  SubagentsChanged,
  TranscriptChunk,
  TranscriptEvent,
  TranscriptOpened,
  TranscriptPosition,
  continuesFrom,
  omittedUpTo,
  positionAfter,
  remainderAfter,
} from '@crook/domain/Transcript'
import {
  AssistantMessage,
  ImageBlock,
  OmittedLines,
  TextBlock,
  UnrecognizedEntry,
} from '@crook/domain/TranscriptMessage'

const FIRST = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
const CLEARED = ClaudeSessionId.make('ff0f77be-1e98-4bb2-8b24-38d673361867')

const at = (session: ClaudeSessionId, offset: number) =>
  new TranscriptPosition({ session, offset: TranscriptOffset.make(offset) })

const chunk = (session: ClaudeSessionId, offset: number, nextOffset: number) =>
  new TranscriptChunk({
    session,
    offset: TranscriptOffset.make(offset),
    nextOffset: TranscriptOffset.make(nextOffset),
    messages: [],
  })

const entryAt = (offset: number) =>
  new UnrecognizedEntry({ offset: TranscriptOffset.make(offset), entryType: 'future' })

const chunkOf = (session: ClaudeSessionId, offsets: readonly number[], nextOffset: number) =>
  new TranscriptChunk({
    session,
    offset: TranscriptOffset.make(offsets[0] ?? nextOffset),
    nextOffset: TranscriptOffset.make(nextOffset),
    messages: offsets.map(entryAt),
  })

describe('positionAfter', () => {
  it('moves to the end of each chunk and keeps its place through a repeated open', () => {
    const opened = positionAfter(Option.none(), new TranscriptOpened({ session: FIRST }))
    const read = positionAfter(opened, chunk(FIRST, 0, 800))

    expect(opened).toEqual(Option.some(at(FIRST, 0)))
    expect(read).toEqual(Option.some(at(FIRST, 800)))
    expect(positionAfter(read, new TranscriptOpened({ session: FIRST }))).toEqual(read)
    expect(positionAfter(read, new SubagentsChanged({ session: FIRST, subagents: [] }))).toEqual(
      read,
    )
  })

  it('starts the next session at its first byte after /clear', () => {
    expect(
      positionAfter(Option.some(at(FIRST, 800)), new TranscriptOpened({ session: CLEARED })),
    ).toEqual(Option.some(at(CLEARED, 0)))
  })
})

describe('omittedUpTo', () => {
  it('stands for the bytes a tail skipped, as the chunk that opens the session', () => {
    const omitted = omittedUpTo(FIRST, TranscriptOffset.make(800))
    const opened = positionAfter(Option.none(), new TranscriptOpened({ session: FIRST }))

    expect(continuesFrom(opened, omitted)).toBe(true)
    expect(positionAfter(opened, omitted)).toEqual(Option.some(at(FIRST, 800)))
    expect(omitted.messages).toEqual([
      new OmittedLines({ offset: TranscriptOffset.make(0), byteLength: 800 }),
    ])
  })
})

describe('continuesFrom', () => {
  it('accepts only the chunk that starts where the last one ended, in the same session', () => {
    const position = Option.some(at(FIRST, 800))

    expect(continuesFrom(position, chunk(FIRST, 800, 900))).toBe(true)
    expect(continuesFrom(position, chunk(FIRST, 0, 900))).toBe(false)
    expect(continuesFrom(position, chunk(CLEARED, 800, 900))).toBe(false)
    expect(continuesFrom(Option.none(), chunk(FIRST, 0, 900))).toBe(false)
  })
})

describe('TranscriptEvent', () => {
  it('crosses the wire as JSON and comes back equal', () => {
    const line = Schema.fromJsonString(Schema.toCodecJson(TranscriptEvent))
    const event = new TranscriptChunk({
      session: FIRST,
      offset: TranscriptOffset.make(0),
      nextOffset: TranscriptOffset.make(2011),
      messages: [
        new AssistantMessage({
          offset: TranscriptOffset.make(0),
          uuid: Option.some('4cd4a376-c169-47ed-9d9d-c56a4111bb9e'),
          timestamp: Option.none(),
          apiMessageId: Option.some('msg_011CgDvMg76yHnSs5ApMVRpE'),
          model: Option.none(),
          stopReason: Option.some('end_turn'),
          isApiError: false,
          blocks: [new TextBlock({ text: 'Red.' })],
        }),
      ],
    })
    const image = new ImageBlock({ mediaType: 'image/png', data: 'iVBORw0KGgo=' })

    expect(Schema.decodeSync(line)(Schema.encodeSync(line)(event))).toEqual(event)
    expect(
      Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(ImageBlock)))(
        Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(ImageBlock)))(image),
      ),
    ).toEqual(image)
  })
})

describe('remainderAfter', () => {
  it('passes on what continues the position, and nothing already behind it', () => {
    const position = Option.some(at(FIRST, 100))

    expect(remainderAfter(position, chunkOf(FIRST, [100, 150], 200))).toEqual(
      Option.some(chunkOf(FIRST, [100, 150], 200)),
    )
    expect(remainderAfter(position, chunkOf(FIRST, [0, 50], 100))).toEqual(Option.none())
    expect(remainderAfter(position, chunkOf(CLEARED, [100], 200))).toEqual(Option.none())
    expect(remainderAfter(Option.none(), chunkOf(FIRST, [0], 100))).toEqual(Option.none())
  })

  it('cuts a chunk that overlaps the position down to the lines after it', () => {
    expect(remainderAfter(Option.some(at(FIRST, 100)), chunkOf(FIRST, [0, 50, 100], 200))).toEqual(
      Option.some(chunkOf(FIRST, [100], 200)),
    )
  })

  it('keeps the part of an Omitted note the position has not passed yet', () => {
    expect(
      remainderAfter(Option.some(at(FIRST, 500)), omittedUpTo(FIRST, TranscriptOffset.make(800))),
    ).toEqual(
      Option.some(
        new TranscriptChunk({
          session: FIRST,
          offset: TranscriptOffset.make(500),
          nextOffset: TranscriptOffset.make(800),
          messages: [new OmittedLines({ offset: TranscriptOffset.make(500), byteLength: 300 })],
        }),
      ),
    )
  })

  it('opens only a session the position is not in, and lists subagents only of its own', () => {
    const position = Option.some(at(FIRST, 100))
    const subagents = new SubagentsChanged({ session: FIRST, subagents: [] })

    expect(remainderAfter(position, new TranscriptOpened({ session: FIRST }))).toEqual(
      Option.none(),
    )
    expect(remainderAfter(position, new TranscriptOpened({ session: CLEARED }))).toEqual(
      Option.some(new TranscriptOpened({ session: CLEARED })),
    )
    expect(remainderAfter(position, subagents)).toEqual(Option.some(subagents))
    expect(
      remainderAfter(position, new SubagentsChanged({ session: CLEARED, subagents: [] })),
    ).toEqual(Option.none())
  })
})
