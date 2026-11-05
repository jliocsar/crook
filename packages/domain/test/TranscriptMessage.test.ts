import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { TranscriptOffset } from '@crook/domain/Ids'
import { LocalCommandBlock, TranscriptMessage, UserMessage } from '@crook/domain/TranscriptMessage'

const WireMessage = Schema.fromJsonString(Schema.toCodecJson(TranscriptMessage))
const encode = Schema.encodeSync(WireMessage)
const decode = Schema.decodeSync(WireMessage)

const OlderPhoneBlock = Schema.TaggedStruct('LocalCommand', {
  name: Schema.String,
  args: Schema.String,
})
const OlderPhoneMessage = Schema.Struct({
  blocks: Schema.Array(OlderPhoneBlock),
})

const lineWith = (block: LocalCommandBlock) =>
  new UserMessage({
    offset: TranscriptOffset.make(0),
    uuid: Option.none(),
    timestamp: Option.none(),
    isMeta: false,
    origin: Option.none(),
    queued: false,
    blocks: [block],
  })

describe('a local command on the wire', () => {
  it('decodes a command from an agent too old to flag one that opens a turn', () => {
    const older = encode(lineWith(new LocalCommandBlock({ name: '/handoff', args: 'made up' })))

    expect(older).not.toContain('opensTurn')
    expect(decode(older)).toMatchObject({
      blocks: [{ _tag: 'LocalCommand', name: '/handoff', args: 'made up' }],
    })
  })

  it('keeps the flag through the wire when the agent sends it', () => {
    const flagged = lineWith(new LocalCommandBlock({ name: '!', args: 'kill 1', opensTurn: true }))

    expect(decode(encode(flagged))).toMatchObject({
      blocks: [{ name: '!', args: 'kill 1', opensTurn: true }],
    })
  })

  it('stays readable by a phone too old to know the flag', () => {
    const newer = encode(
      lineWith(new LocalCommandBlock({ name: '/handoff', args: 'made up', opensTurn: true })),
    )

    expect(Schema.decodeSync(Schema.fromJsonString(OlderPhoneMessage))(newer)).toStrictEqual({
      blocks: [{ _tag: 'LocalCommand', name: '/handoff', args: 'made up' }],
    })
  })
})
