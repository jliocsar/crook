import * as Arr from 'effect/Array'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Schema from 'effect/Schema'

import type { Page } from '@crook/frames/Browser'
import { frameUrl, navigate, SETTLED_PHASES, waitForPhase } from '@crook/frames/Capture'

type Side = keyof Box

interface Place {
  readonly story: string
  readonly selector: string
  readonly pick: 'first' | 'last'
}

export interface FitCheck {
  readonly name: string
  readonly skeleton: Place
  readonly real: Place
  readonly sides: readonly Side[]
}

export const Box = Schema.Struct({
  left: Schema.Finite,
  top: Schema.Finite,
  right: Schema.Finite,
  bottom: Schema.Finite,
})
export type Box = typeof Box.Type

const Reading = Schema.fromJsonString(Schema.Struct({ box: Schema.NullOr(Box), bones: Schema.Int }))
type Reading = typeof Reading.Type

const ALL_SIDES: readonly Side[] = ['left', 'top', 'right', 'bottom']
const SETTLE = Duration.seconds(1)
const SAMPLE = '[skullet-ghost]'

export const FIT_TOLERANCE_PX = 1

export const FIT_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const

export const FIT_CHECKS: readonly FitCheck[] = [
  {
    name: 'a herd card',
    skeleton: {
      story: 'herd/skeleton',
      selector: `${SAMPLE} [data-slot="swipe-card"]`,
      pick: 'first',
    },
    real: {
      story: 'link/dialing-announced-syncing/agents',
      selector: '[data-slot="swipe-card"]',
      pick: 'first',
    },
    sides: ALL_SIDES,
  },
  {
    name: 'a machine card',
    skeleton: {
      story: 'machines/skeleton',
      selector: `${SAMPLE} [data-slot="machine-list"] > li`,
      pick: 'first',
    },
    real: {
      story: 'link/dialing-announced-syncing/machines',
      selector: '[data-slot="machine-list"] > li',
      pick: 'first',
    },
    sides: ALL_SIDES,
  },
  {
    name: 'where a long chat ends',
    skeleton: {
      story: 'chat/skeleton',
      selector: `${SAMPLE} [data-slot="thread-sample"] > *`,
      pick: 'last',
    },
    real: {
      story: 'chat/long-end',
      selector: '[data-slot="conversation-content"] [data-row] > *',
      pick: 'last',
    },
    sides: ['bottom', 'left', 'right'],
  },
]

const readingOf = ({ selector, pick }: Place): string =>
  `(() => {
    const found = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const element = found[${pick === 'first' ? '0' : 'found.length - 1'}]
    const rect = element?.getBoundingClientRect()
    const layer = document.querySelector('[skullet-layer]')

    return JSON.stringify({
      box: rect === undefined ? null : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      bones: layer?.shadowRoot?.children.length ?? 0,
    })
  })()`

export const fitFindings = (
  check: FitCheck,
  skeleton: Reading,
  real: Reading,
): readonly string[] => {
  if (skeleton.box === null || real.box === null) {
    return [
      `${check.name}: ${skeleton.box === null ? 'the skeleton' : 'the real screen'} showed none.`,
    ]
  }

  const [drawn, shown] = [skeleton.box, real.box]

  return [
    ...(skeleton.bones === 0 ? [`${check.name}: the skeleton drew no bones.`] : []),
    ...pipe(
      check.sides,
      Arr.filter((side) => Math.abs(drawn[side] - shown[side]) > FIT_TOLERANCE_PX),
      Arr.map(
        (side) =>
          `${check.name}: its ${side} edge sits at ${drawn[side]} in the skeleton and ${shown[side]} on the real screen.`,
      ),
    ),
  ]
}

const decodeReading = Schema.decodeUnknownEffect(Reading)

const read = Effect.fn('SkeletonFit.read')(function* (page: Page, place: Place) {
  const url = frameUrl(place.story, false)

  yield* navigate(page, url)
  yield* waitForPhase(page, place.story, url, SETTLED_PHASES)
  yield* Effect.sleep(SETTLE)

  return yield* decodeReading(yield* page.evaluate(readingOf(place)))
})

export const judgeSkeletonFit = Effect.fn('SkeletonFit.judge')(function* (page: Page) {
  const findings = yield* Effect.forEach(FIT_VIEWPORTS, (viewport) =>
    Effect.gen(function* () {
      yield* page.send('Emulation.setDeviceMetricsOverride', {
        ...viewport,
        deviceScaleFactor: 1,
        mobile: false,
      })

      const perCheck = yield* Effect.forEach(FIT_CHECKS, (check) =>
        Effect.gen(function* () {
          const skeleton = yield* read(page, check.skeleton)
          const real = yield* read(page, check.real)

          return fitFindings(check, skeleton, real)
        }),
      )

      return pipe(
        perCheck,
        Arr.flatten,
        Arr.map((finding) => `${viewport.width}x${viewport.height}, ${finding}`),
      )
    }),
  )

  return Arr.flatten(findings)
})
