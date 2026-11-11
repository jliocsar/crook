import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

export type AttachmentKind = 'image' | 'file'

export type AttachmentRefusal = AttachmentUnreadable | TooManyAttachments | AttachmentsTooLarge

export type ImageFormat = 'image/png' | 'image/jpeg'

export interface DraftAttachment {
  readonly id: string
  readonly name: string
  readonly mediaType: string
  readonly kind: AttachmentKind
  readonly bytes: Uint8Array<ArrayBuffer>
}

export interface ImageSize {
  readonly width: number
  readonly height: number
}

export type ImagePlan =
  | { readonly keep: true }
  | { readonly keep: false; readonly size: ImageSize; readonly format: ImageFormat }

export interface ImageCodec {
  readonly measure: (blob: Blob) => Effect.Effect<ImageSize, ImageUndecodable>
  readonly redraw: (
    blob: Blob,
    size: ImageSize,
    format: ImageFormat,
  ) => Effect.Effect<Uint8Array<ArrayBuffer>, ImageUndecodable>
}

const KIBIBYTE = 1024
const MEBIBYTE = KIBIBYTE * KIBIBYTE
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38]
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]
const WEBP_OFFSET = 8
const ISO_BOX_TYPE = [0x66, 0x74, 0x79, 0x70]
const ISO_BOX_OFFSET = 4
const ISO_BRAND_OFFSET = 8
const ISO_BRAND_LENGTH = 4
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1', 'avif']
const ATTACHMENT_ID_BYTES = 8
const HEX_RADIX = 16
const HEX_DIGITS_PER_BYTE = 2
const PASTED_NAME = 'Pasted image'
const UNNAMED_FILE = 'File'
const JPEG_EXTENSION = /\.(?:jpe?g|heic|heif|webp|gif|avif)$/iu
const PNG_EXTENSION = /\.png$/iu

export const ATTACHMENT_COUNT_LIMIT = 10
export const ATTACHMENT_BYTES_LIMIT = 25 * MEBIBYTE
export const IMAGE_LONG_EDGE = 2000
export const JPEG_QUALITY = 0.85

export class ImageUndecodable extends Schema.TaggedError<ImageUndecodable>()('ImageUndecodable', {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return 'This browser could not open the picture to shrink it. Attach it as a screenshot or a JPEG instead.'
  }
}

export class AttachmentUnreadable extends Schema.TaggedError<AttachmentUnreadable>()(
  'AttachmentUnreadable',
  { fileName: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `crook could not read ${this.fileName}. Pick it again, or save it to Files first.`
  }
}

export class TooManyAttachments extends Schema.TaggedError<TooManyAttachments>()(
  'TooManyAttachments',
  { limit: Schema.Int },
) {
  override get message(): string {
    return `A message can carry at most ${this.limit} attachments. Send these, then attach the rest.`
  }
}

export class AttachmentsTooLarge extends Schema.TaggedError<AttachmentsTooLarge>()(
  'AttachmentsTooLarge',
  { limitBytes: Schema.Int },
) {
  override get message(): string {
    return `A message's attachments can add up to ${sizeLabel(this.limitBytes)}. Remove one, or send them across two messages.`
  }
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, index) => bytes[offset + index] === byte)

const isoBrand = (bytes: Uint8Array): Option.Option<string> =>
  Option.liftPredicate(bytes, (candidate) =>
    startsWith(candidate, ISO_BOX_TYPE, ISO_BOX_OFFSET),
  ).pipe(
    Option.map((candidate) =>
      String.fromCodePoint(
        ...candidate.subarray(ISO_BRAND_OFFSET, ISO_BRAND_OFFSET + ISO_BRAND_LENGTH),
      ),
    ),
  )

export const isPicture = (bytes: Uint8Array): boolean =>
  startsWith(bytes, PNG_SIGNATURE) ||
  startsWith(bytes, JPEG_SIGNATURE) ||
  startsWith(bytes, GIF_SIGNATURE) ||
  (startsWith(bytes, RIFF_SIGNATURE) && startsWith(bytes, WEBP_SIGNATURE, WEBP_OFFSET)) ||
  Option.exists(isoBrand(bytes), (brand) => HEIF_BRANDS.includes(brand))

export const isPng = (bytes: Uint8Array): boolean => startsWith(bytes, PNG_SIGNATURE)

export const imagePlan = (size: ImageSize, png: boolean): ImagePlan => {
  const longEdge = Math.max(size.width, size.height)

  if (png && longEdge <= IMAGE_LONG_EDGE) {
    return { keep: true }
  }

  const scale = Math.min(1, IMAGE_LONG_EDGE / longEdge)

  return {
    keep: false,
    size: {
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
    },
    format: png ? 'image/png' : 'image/jpeg',
  }
}

export const sizeLabel = (bytes: number): string => {
  if (bytes < KIBIBYTE) {
    return `${bytes} B`
  }

  return bytes < MEBIBYTE
    ? `${Math.round(bytes / KIBIBYTE)} KB`
    : `${(bytes / MEBIBYTE).toFixed(1)} MB`
}

const renamed = (name: string, format: ImageFormat): string => {
  const stem = name.replace(JPEG_EXTENSION, '').replace(PNG_EXTENSION, '')

  return format === 'image/png' ? `${stem}.png` : `${stem}.jpg`
}

const attachmentId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(ATTACHMENT_ID_BYTES)), (byte) =>
    byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0'),
  ).join('')

const readBytes = (file: Blob, fileName: string) =>
  Effect.tryPromise({
    try: () => file.arrayBuffer(),
    catch: (cause) => new AttachmentUnreadable({ fileName, cause }),
  }).pipe(Effect.map((buffer) => new Uint8Array(buffer)))

const asFile = (
  name: string,
  mediaType: string,
  bytes: Uint8Array<ArrayBuffer>,
): DraftAttachment => ({
  id: attachmentId(),
  name,
  mediaType,
  kind: 'file',
  bytes,
})

const asImage = (
  name: string,
  format: ImageFormat,
  bytes: Uint8Array<ArrayBuffer>,
): DraftAttachment => ({
  id: attachmentId(),
  name,
  mediaType: format,
  kind: 'image',
  bytes,
})

const shrunk = (codec: ImageCodec, name: string, file: Blob, bytes: Uint8Array<ArrayBuffer>) =>
  codec.measure(file).pipe(
    Effect.flatMap((size) => {
      const plan = imagePlan(size, isPng(bytes))

      return plan.keep
        ? Effect.succeed(asImage(name, 'image/png', bytes))
        : Effect.map(codec.redraw(file, plan.size, plan.format), (redrawn) =>
            asImage(renamed(name, plan.format), plan.format, redrawn),
          )
    }),
  )

const nameOf = (file: File): string => {
  if (file.name.trim() !== '') {
    return file.name
  }

  return file.type.startsWith('image/') ? PASTED_NAME : UNNAMED_FILE
}

export const attachmentOf = Effect.fn('Attachments.attachmentOf')(function* (
  codec: ImageCodec,
  file: File,
) {
  const name = nameOf(file)
  const bytes = yield* readBytes(file, name)

  if (!isPicture(bytes)) {
    return asFile(name, file.type, bytes)
  }

  return yield* shrunk(codec, name, file, bytes).pipe(
    Effect.orElseSucceed(() => asFile(name, file.type, bytes)),
  )
})

export const totalBytes = (attachments: readonly DraftAttachment[]): number =>
  attachments.reduce((sum, attachment) => sum + attachment.bytes.byteLength, 0)

export const withAdded = (
  current: readonly DraftAttachment[],
  added: readonly DraftAttachment[],
): Effect.Effect<readonly DraftAttachment[], TooManyAttachments | AttachmentsTooLarge> => {
  const next = Arr.appendAll(current, added)

  if (next.length > ATTACHMENT_COUNT_LIMIT) {
    return Effect.fail(new TooManyAttachments({ limit: ATTACHMENT_COUNT_LIMIT }))
  }

  return totalBytes(next) > ATTACHMENT_BYTES_LIMIT
    ? Effect.fail(new AttachmentsTooLarge({ limitBytes: ATTACHMENT_BYTES_LIMIT }))
    : Effect.succeed(next)
}

export const filesOfTransfer = (transfer: DataTransfer | null): readonly File[] =>
  transfer === null ? [] : Array.from(transfer.files)
