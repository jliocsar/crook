import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import { commandAudit } from '@crook/domain/Audit'
import {
  ATTACHMENT_BYTES_LIMIT,
  ATTACHMENT_COUNT_LIMIT,
  AttachmentDigest,
  AttachmentRef,
  Prompt,
} from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'

const PANE = PaneId.make('w1:p1')
const DIGEST = AttachmentDigest.make('a'.repeat(64))

const ref = (size: number) =>
  new AttachmentRef({ name: 'shot.png', mediaType: 'image/png', size, digest: DIGEST })

const decode = Schema.decodeUnknownResult(Prompt)

const wire = (fields: { readonly text: string; readonly attachments?: readonly object[] }) => ({
  _tag: 'Prompt',
  pane: PANE,
  ...fields,
})

describe('Prompt attachments', () => {
  it('decodes a prompt from a phone that predates attachments with none', () => {
    const decoded = decode(wire({ text: 'continue' }))

    expect(Result.map(decoded, (prompt) => prompt.attachments)).toEqual(Result.succeed([]))
  })

  it('takes text alone, attachments alone, and refuses a prompt with neither', () => {
    const digestOnly = { name: 'shot.png', mediaType: 'image/png', size: 3, digest: DIGEST }

    expect(Result.isSuccess(decode(wire({ text: 'look', attachments: [] })))).toBe(true)
    expect(Result.isSuccess(decode(wire({ text: '', attachments: [digestOnly] })))).toBe(true)
    expect(Result.isFailure(decode(wire({ text: '', attachments: [] })))).toBe(true)
  })

  it('refuses more attachments, or more bytes, than a message may carry', () => {
    const many = Arr.makeBy(ATTACHMENT_COUNT_LIMIT + 1, () =>
      Schema.encodeSync(AttachmentRef)(ref(1)),
    )
    const halves = Arr.makeBy(3, () =>
      Schema.encodeSync(AttachmentRef)(ref(Math.ceil(ATTACHMENT_BYTES_LIMIT / 2))),
    )

    expect(Result.isFailure(decode(wire({ text: 'x', attachments: many })))).toBe(true)
    expect(Result.isFailure(decode(wire({ text: 'x', attachments: halves })))).toBe(true)
  })

  it('refuses a digest that is not a sha-256 in hex', () => {
    const bad = { name: 'a', mediaType: 'text/plain', size: 1, digest: '../../etc/passwd' }

    expect(Result.isFailure(decode(wire({ text: 'x', attachments: [bad] })))).toBe(true)
  })

  it('audits how many were attached and their size, never their names', () => {
    const audited = commandAudit(
      new Prompt({ pane: PANE, text: '', attachments: [ref(10), ref(5)] }),
    )

    expect(audited.arguments).toEqual({ pane: PANE, text: '', attachments: '2 attached, 15 bytes' })
  })
})
