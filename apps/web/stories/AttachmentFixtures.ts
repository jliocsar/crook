import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

const PHOTO_WIDTH = 1200
const PHOTO_HEIGHT = 900
const SCREENSHOT_WIDTH = 390
const SCREENSHOT_HEIGHT = 844
const PHOTO_SKY = '#7aa7d9'
const PHOTO_GROUND = '#5b8a4b'
const SCREENSHOT_PAPER = '#f4f1ea'
const SCREENSHOT_INK = '#2b2a28'
const BAR_HEIGHT = 18
const BAR_GAP = 34
const BAR_INSET = 24
const UNDRAWN = [0x89, 0x50, 0x4e, 0x47]

export const PHOTO_NAME = 'IMG_2041.jpg'
export const SCREENSHOT_NAME = 'Screenshot.png'
export const LOG_NAME = 'build-log.txt'
export const LOG_TEXT = 'step 3 of 7 failed: tsc exited with code 2\n'

class CanvasUnavailable extends Schema.TaggedError<CanvasUnavailable>()('CanvasUnavailable', {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return 'This page cannot draw a picture, so the story attaches a stand-in the browser cannot open.'
  }
}

const drawn = (
  width: number,
  height: number,
  type: string,
  paint: (context: OffscreenCanvasRenderingContext2D) => void,
) =>
  Effect.tryPromise({
    try: () => {
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')

      if (context !== null) {
        paint(context)
      }

      return canvas.convertToBlob({ type })
    },
    catch: (cause) => new CanvasUnavailable({ cause }),
  })

const pictureOf = (
  name: string,
  width: number,
  height: number,
  type: string,
  paint: (context: OffscreenCanvasRenderingContext2D) => void,
) =>
  drawn(width, height, type, paint).pipe(
    Effect.map((blob) => new File([blob], name, { type })),
    Effect.orElseSucceed(() => new File([new Uint8Array(UNDRAWN)], name, { type })),
  )

export const photo = pictureOf(PHOTO_NAME, PHOTO_WIDTH, PHOTO_HEIGHT, 'image/jpeg', (context) => {
  context.fillStyle = PHOTO_SKY
  context.fillRect(0, 0, PHOTO_WIDTH, PHOTO_HEIGHT)
  context.fillStyle = PHOTO_GROUND
  context.fillRect(0, PHOTO_HEIGHT / 2, PHOTO_WIDTH, PHOTO_HEIGHT / 2)
})

export const screenshot = pictureOf(
  SCREENSHOT_NAME,
  SCREENSHOT_WIDTH,
  SCREENSHOT_HEIGHT,
  'image/png',
  (context) => {
    context.fillStyle = SCREENSHOT_PAPER
    context.fillRect(0, 0, SCREENSHOT_WIDTH, SCREENSHOT_HEIGHT)
    context.fillStyle = SCREENSHOT_INK
    Arr.makeBy(Math.floor(SCREENSHOT_HEIGHT / BAR_GAP), (index) => index).forEach((index) => {
      context.fillRect(BAR_INSET, BAR_INSET + index * BAR_GAP, SCREENSHOT_WIDTH / 2, BAR_HEIGHT)
    })
  },
)

export const buildLog = () => new File([LOG_TEXT], LOG_NAME, { type: 'text/plain' })

export const threeFiles = Effect.map(Effect.all([photo, screenshot]), ([picture, shot]) => [
  picture,
  shot,
  buildLog(),
])
