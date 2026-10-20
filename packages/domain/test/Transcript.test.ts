import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { ClaudeSessionId, SubagentId, TranscriptOffset } from '@crook/domain/Ids'
import { Subagent, runningCount } from '@crook/domain/Subagent'
import {
  SubagentsChanged,
  TranscriptChunk,
  TranscriptEvent,
  TranscriptOpened,
  TranscriptPosition,
  continuesFrom,
  positionAfter,
} from '@crook/domain/Transcript'
import { AssistantMessage, ImageBlock, TextBlock } from '@crook/domain/TranscriptMessage'

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

const subagent = (id: string, finished: boolean) =>
  new Subagent({
    id: SubagentId.make(id),
    agentType: 'general-purpose',
    description: 'Read hello.txt',
    model: Option.none(),
    toolUseId: Option.none(),
    parent: Option.none(),
    spawnDepth: 1,
    background: true,
    finished,
    stoppedByUser: false,
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
          line: TranscriptOffset.make(0),
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

describe('runningCount', () => {
  it('counts subagents that have not finished', () => {
    expect(
      runningCount([subagent('a370777a87a436836', true), subagent('aa5c894dc268d33c7', false)]),
    ).toBe(1)
  })
})
