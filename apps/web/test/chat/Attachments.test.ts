import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'

import {
  ATTACHMENT_BYTES_LIMIT,
  ATTACHMENT_COUNT_LIMIT,
  AttachmentDigest,
} from '@crook/domain/Command'
import {
  attachmentOf,
  type DraftAttachment,
  type ImageCodec,
  imagePlan,
  ImageUndecodable,
  isPicture,
  sizeLabel,
  withAdded,
} from '@crook/web/chat/Attachments'

type Redraw = { readonly width: number; readonly height: number; readonly format: string }

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]
const HEIC_HEAD = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]
const TEXT = 'hello'
const REDRAWN = [1, 2, 3]

const fileOf = (bytes: readonly number[], name: string, type: string) =>
  new File([new Uint8Array(bytes)], name, { type })

const codecOf = (width: number, height: number): ImageCodec & { readonly redrawn: Redraw[] } => {
  const redrawn: Redraw[] = []

  return {
    redrawn,
    measure: () => Effect.succeed({ width, height }),
    redraw: (_blob, size, format) =>
      Effect.sync(() => {
        redrawn.push({ ...size, format })

        return new Uint8Array(REDRAWN)
      }),
  }
}

const undecodable: ImageCodec = {
  measure: () => Effect.fail(new ImageUndecodable({ cause: new Error('no decoder') })),
  redraw: () => Effect.fail(new ImageUndecodable({ cause: new Error('no decoder') })),
}

const attachment = (byteLength: number): DraftAttachment => ({
  id: `a${byteLength}`,
  name: 'notes.txt',
  mediaType: 'text/plain',
  kind: 'file',
  bytes: new Uint8Array(byteLength),
  digest: AttachmentDigest.make('0'.repeat(64)),
})

describe('imagePlan', () => {
  it('keeps a PNG whose long edge fits, and redraws any other picture as a JPEG', () => {
    expect(imagePlan({ width: 1170, height: 2532 }, true)).toEqual({
      keep: false,
      size: { width: 924, height: 2000 },
      format: 'image/png',
    })
    expect(imagePlan({ width: 1200, height: 800 }, true)).toEqual({ keep: true })
    expect(imagePlan({ width: 1200, height: 800 }, false)).toEqual({
      keep: false,
      size: { width: 1200, height: 800 },
      format: 'image/jpeg',
    })
    expect(imagePlan({ width: 4032, height: 3024 }, false)).toEqual({
      keep: false,
      size: { width: 2000, height: 1500 },
      format: 'image/jpeg',
    })
  })
})

describe('isPicture', () => {
  it('reads the bytes, not the name or the type the browser claimed', () => {
    expect(isPicture(new Uint8Array(PNG_HEAD))).toBe(true)
    expect(isPicture(new Uint8Array(JPEG_HEAD))).toBe(true)
    expect(isPicture(new Uint8Array(HEIC_HEAD))).toBe(true)
    expect(isPicture(new TextEncoder().encode(TEXT))).toBe(false)
    expect(isPicture(new Uint8Array())).toBe(false)
  })
})

describe('attachmentOf', () => {
  it.effect('redraws a phone photo as a JPEG under the long-edge cap and renames it', () =>
    Effect.gen(function* () {
      const codec = codecOf(4032, 3024)
      const made = yield* attachmentOf(codec, fileOf(HEIC_HEAD, 'IMG_0001.HEIC', 'image/heic'))

      expect(made).toMatchObject({ name: 'IMG_0001.jpg', mediaType: 'image/jpeg', kind: 'image' })
      expect(Array.from(made.bytes)).toEqual(REDRAWN)
      expect(codec.redrawn).toEqual([{ width: 2000, height: 1500, format: 'image/jpeg' }])
    }),
  )

  it.effect('keeps a pasted screenshot as it is, named for where it came from', () =>
    Effect.gen(function* () {
      const codec = codecOf(1170, 1000)
      const made = yield* attachmentOf(codec, fileOf(PNG_HEAD, '', 'image/png'))

      expect(made).toMatchObject({ name: 'Pasted image', mediaType: 'image/png', kind: 'image' })
      expect(Array.from(made.bytes)).toEqual(PNG_HEAD)
      expect(codec.redrawn).toEqual([])
    }),
  )

  it.effect('passes any other file through as it is', () =>
    Effect.gen(function* () {
      const bytes = Array.from(new TextEncoder().encode(TEXT))
      const made = yield* attachmentOf(
        codecOf(1, 1),
        fileOf(bytes, 'report.pdf', 'application/pdf'),
      )

      expect(made).toMatchObject({ name: 'report.pdf', mediaType: 'application/pdf', kind: 'file' })
      expect(Array.from(made.bytes)).toEqual(bytes)
    }),
  )

  it.effect('falls back to a plain file when the browser cannot open the picture', () =>
    Effect.gen(function* () {
      const made = yield* attachmentOf(undecodable, fileOf(HEIC_HEAD, 'IMG.HEIC', 'image/heic'))

      expect(made).toMatchObject({ name: 'IMG.HEIC', mediaType: 'image/heic', kind: 'file' })
    }),
  )
})

describe('withAdded', () => {
  it.effect('refuses past the count and the total size, and keeps what fits', () =>
    Effect.gen(function* () {
      const one = [attachment(1)]
      const many = Arr.makeBy(ATTACHMENT_COUNT_LIMIT, (index) => attachment(index))
      const fits = yield* withAdded(one, [attachment(2)])
      const tooMany = yield* Effect.exit(withAdded(many, [attachment(1)]))
      const tooLarge = yield* Effect.exit(withAdded(one, [attachment(ATTACHMENT_BYTES_LIMIT)]))

      expect(fits.map((added) => added.bytes.byteLength)).toEqual([1, 2])
      expect(Exit.isFailure(tooMany)).toBe(true)
      expect(Exit.isFailure(tooLarge)).toBe(true)
    }),
  )
})

describe('sizeLabel', () => {
  it('reads bytes the way a person would', () => {
    expect(sizeLabel(512)).toBe('512 B')
    expect(sizeLabel(82_668)).toBe('81 KB')
    expect(sizeLabel(3_881_198)).toBe('3.7 MB')
  })
})
