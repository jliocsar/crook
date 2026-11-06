import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Struct from 'effect/Struct'

import { TranscriptOffset } from '@crook/domain/Ids'
import {
  LocalCommandBlock,
  TextBlock,
  TranscriptMessage,
  UserMessage,
} from '@crook/domain/TranscriptMessage'

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

describe('a Stop hook feedback line on the wire', () => {
  const feedback = new UserMessage({
    offset: TranscriptOffset.make(0),
    uuid: Option.none(),
    timestamp: Option.none(),
    isMeta: true,
    origin: Option.none(),
    queued: false,
    blocks: [new TextBlock({ text: '[/made/up/check.sh]: Run the check first.' })],
    stopHookFeedback: true,
  })

  it('keeps the key through the wire, and a line from an older agent decodes without it', () => {
    const older = encode(lineWith(new LocalCommandBlock({ name: '/handoff', args: 'made up' })))

    expect(decode(encode(feedback))).toMatchObject({ stopHookFeedback: true })
    expect(older).not.toContain('stopHookFeedback')
    expect(decode(older)).not.toHaveProperty('stopHookFeedback')
  })

  it('stays a plain meta line for a phone too old to know the key', () => {
    const OlderPhoneLine = Schema.Struct({ isMeta: Schema.Boolean })

    expect(
      Schema.decodeSync(Schema.fromJsonString(OlderPhoneLine))(encode(feedback)),
    ).toStrictEqual({ isMeta: true })
  })
})

describe('who sent a prompt, on the wire', () => {
  const sent = new UserMessage({
    offset: TranscriptOffset.make(0),
    uuid: Option.none(),
    timestamp: Option.none(),
    isMeta: false,
    origin: Option.none(),
    queued: false,
    blocks: [new TextBlock({ text: 'A made-up reply' })],
    sentBy: { kind: 'plugin', name: 'madeup' },
  })

  it('keeps the key through the wire, a kind this build never heard of included', () => {
    const unheardOf = new UserMessage(
      Struct.evolve(sent, { sentBy: () => ({ kind: 'made_up_origin' }) }),
    )

    expect(decode(encode(sent))).toMatchObject({ sentBy: { kind: 'plugin', name: 'madeup' } })
    expect(decode(encode(unheardOf))).toMatchObject({ sentBy: { kind: 'made_up_origin' } })
  })

  it('stays out of a line from an agent too old to send it', () => {
    const older = encode(lineWith(new LocalCommandBlock({ name: '/handoff', args: 'made up' })))

    expect(older).not.toContain('sentBy')
    expect(decode(older)).not.toHaveProperty('sentBy')
  })

  it('is dropped by a phone too old to know it, which still reads the prompt', () => {
    const OlderPhoneLine = Schema.Struct({
      isMeta: Schema.Boolean,
      blocks: Schema.Array(Schema.Struct({ text: Schema.String })),
    })

    expect(Schema.decodeSync(Schema.fromJsonString(OlderPhoneLine))(encode(sent))).toStrictEqual({
      isMeta: false,
      blocks: [{ text: 'A made-up reply' }],
    })
  })
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
