import * as Effect from 'effect/Effect'

import {
  type ImageCodec,
  type ImageFormat,
  type ImageSize,
  ImageUndecodable,
  JPEG_QUALITY,
} from '@crook/web/chat/Attachments'

const decoded = (blob: Blob) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => createImageBitmap(blob, { imageOrientation: 'from-image' }),
      catch: (cause) => new ImageUndecodable({ cause }),
    }),
    (bitmap) =>
      Effect.sync(() => {
        bitmap.close()
      }),
  )

const encoded = (canvas: HTMLCanvasElement, format: ImageFormat) =>
  Effect.callback<Blob, ImageUndecodable>((resume) => {
    canvas.toBlob(
      (blob) => {
        resume(
          blob === null
            ? Effect.fail(new ImageUndecodable({ cause: new Error('toBlob gave nothing') }))
            : Effect.succeed(blob),
        )
      },
      format,
      JPEG_QUALITY,
    )
  })

const bytesOf = (blob: Blob) =>
  Effect.tryPromise({
    try: () => blob.arrayBuffer(),
    catch: (cause) => new ImageUndecodable({ cause }),
  }).pipe(Effect.map((buffer) => new Uint8Array(buffer)))

const measure = (blob: Blob) =>
  decoded(blob).pipe(
    Effect.map((bitmap): ImageSize => ({ width: bitmap.width, height: bitmap.height })),
    Effect.scoped,
  )

const redraw = (blob: Blob, size: ImageSize, format: ImageFormat) =>
  Effect.gen(function* () {
    const bitmap = yield* decoded(blob)
    const canvas = document.createElement('canvas')

    canvas.width = size.width
    canvas.height = size.height

    const context = canvas.getContext('2d')

    if (context === null) {
      return yield* new ImageUndecodable({ cause: new Error('no 2d context') })
    }

    if (format === 'image/jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, size.width, size.height)
    }

    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, size.width, size.height)

    return yield* encoded(canvas, format).pipe(Effect.flatMap(bytesOf))
  }).pipe(Effect.scoped)

export const browserImageCodec: ImageCodec = { measure, redraw }
