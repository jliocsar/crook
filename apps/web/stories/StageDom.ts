import { fireEvent, waitFor, within } from '@testing-library/dom'
import type { ByRoleMatcher } from '@testing-library/dom'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'

import { StoryStepFailed } from './Story.tsx'
import type { Witness } from './Story.tsx'

const FIND_TIMEOUT_MS = 4000
const SWIPE_STEP_MS = 16

const pointerUser = () => {
  window.focus()

  return userEvent.setup({ delay: null, pointerEventsCheck: PointerEventsCheckLevel.Never })
}

const failedWith = (what: string) => (cause: unknown) =>
  new StoryStepFailed({
    step: what,
    detail:
      cause instanceof Error ? (cause.message.split('\n')[0] ?? cause.message) : String(cause),
  })

const attempt = <Value>(what: string, run: () => Promise<Value>) =>
  Effect.tryPromise({ try: run, catch: failedWith(what) })

const body = () => within(document.body)

const pageText = () => document.body.textContent ?? ''

const someFieldHolds = (text: string): boolean =>
  Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'),
  ).some((field) => field.value === text)

const holds = (witness: Witness): boolean =>
  Match.value(witness).pipe(
    Match.when({ all: Match.any }, ({ all }) => all.every(holds)),
    Match.when({ text: Match.string }, ({ text }) => pageText().includes(text)),
    Match.when(
      { selector: Match.string },
      ({ selector }) => document.querySelector(selector) !== null,
    ),
    Match.when({ absent: Match.string }, ({ absent }) => !pageText().includes(absent)),
    Match.when({ field: Match.string }, ({ field }) => someFieldHolds(field)),
    Match.exhaustive,
  )

const witnessName = (witness: Witness): string =>
  Match.value(witness).pipe(
    Match.when({ all: Match.any }, ({ all }) => all.map(witnessName).join(', ')),
    Match.when({ text: Match.string }, ({ text }) => `sees "${text}"`),
    Match.when({ selector: Match.string }, ({ selector }) => `sees ${selector}`),
    Match.when({ absent: Match.string }, ({ absent }) => `no longer sees "${absent}"`),
    Match.when({ field: Match.string }, ({ field }) => `sees a field holding "${field}"`),
    Match.exhaustive,
  )

export const pause = (milliseconds: number) => Effect.sleep(Duration.millis(milliseconds))

export const seesWithin = (timeout: number, witness: Witness) =>
  attempt(witnessName(witness), () =>
    waitFor(
      () => {
        if (!holds(witness)) {
          throw new Error(`Still waiting: ${witnessName(witness)}.`)
        }
      },
      { timeout },
    ),
  )

export const sees = (witness: Witness) => seesWithin(FIND_TIMEOUT_MS, witness)

export const until = (what: string, reached: () => boolean) =>
  attempt(what, () =>
    waitFor(
      () => {
        if (!reached()) {
          throw new Error(`Still waiting: ${what}.`)
        }
      },
      { timeout: FIND_TIMEOUT_MS },
    ),
  )

export const seesText = (text: string) => sees({ text })

export const seesSelector = (selector: string) => sees({ selector })

export const element = (selector: string) =>
  attempt(`finds ${selector}`, () =>
    waitFor(
      () => {
        const found = document.querySelector<HTMLElement>(selector)

        if (found === null) {
          throw new Error(`Nothing matches ${selector}.`)
        }

        return found
      },
      { timeout: FIND_TIMEOUT_MS },
    ),
  )

export const role = (name: string | RegExp, matcher: ByRoleMatcher = 'button') =>
  attempt(`finds the ${String(matcher)} ${String(name)}`, () =>
    body().findByRole(matcher, { name }, { timeout: FIND_TIMEOUT_MS }),
  )

export const clickElement = (target: Element, what = 'clicks an element') =>
  attempt(what, () => pointerUser().click(target))

export const clicks = (name: string | RegExp, matcher: ByRoleMatcher = 'button') =>
  Effect.flatMap(role(name, matcher), (target) => clickElement(target, `clicks ${String(name)}`))

export const clicksSelector = (selector: string) =>
  Effect.flatMap(element(selector), (target) => clickElement(target, `clicks ${selector}`))

const typeInto = (target: HTMLInputElement | HTMLTextAreaElement, text: string) =>
  Effect.sync(() => {
    const value = `${target.value}${text}`

    window.focus()
    target.focus()
    fireEvent.input(target, { target: { value } })
    target.setSelectionRange(value.length, value.length)
    fireEvent.select(target)
  })

const textFieldOf = (found: HTMLElement, what: string) =>
  found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement
    ? Effect.succeed(found)
    : Effect.fail(new StoryStepFailed({ step: what, detail: 'It is not a text field.' }))

export const pastes = (name: string | RegExp, files: readonly File[]) =>
  role(name, 'textbox').pipe(
    Effect.flatMap((target) =>
      Effect.sync(() => {
        target.focus()
        const transfer = new DataTransfer()

        files.forEach((file) => {
          transfer.items.add(file)
        })
        target.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
        )
      }),
    ),
  )

export const types = (name: string | RegExp, text: string, matcher: ByRoleMatcher = 'textbox') =>
  role(name, matcher).pipe(
    Effect.flatMap((found) => textFieldOf(found, `types into ${String(name)}`)),
    Effect.flatMap((target) => typeInto(target, text)),
  )

export const typesInto = (placeholder: string, text: string) =>
  attempt(`finds the field ${placeholder}`, () =>
    body().findByPlaceholderText(placeholder, {}, { timeout: FIND_TIMEOUT_MS }),
  ).pipe(
    Effect.flatMap((found) => textFieldOf(found, `types into ${placeholder}`)),
    Effect.flatMap((target) => typeInto(target, text)),
  )

export const holdsDown = (name: string | RegExp, milliseconds: number) =>
  Effect.flatMap(role(name), (target) =>
    Effect.gen(function* () {
      const finger = pointerUser()

      yield* attempt(`presses ${String(name)}`, () => finger.pointer({ keys: '[TouchA>]', target }))
      yield* pause(milliseconds)
      yield* attempt(`lifts off ${String(name)}`, () =>
        finger.pointer({ keys: '[/TouchA]', target }),
      )
    }),
  )

const whenEnabled = (target: HTMLElement) =>
  until(`${target.textContent} to be enabled`, () => !target.matches(':disabled'))

export const pressesInstantly = (name: string | RegExp) =>
  Effect.flatMap(role(name), (target) =>
    Effect.andThen(
      whenEnabled(target),
      Effect.sync(() => {
        target.click()
      }),
    ),
  )

export const pressesEvenIfHidden = (name: string | RegExp) =>
  Effect.flatMap(
    attempt(`finds the hidden button ${String(name)}`, () =>
      body().findAllByRole('button', { name, hidden: true }, { timeout: FIND_TIMEOUT_MS }),
    ),
    ([target]) =>
      Effect.sync(() => {
        target?.click()
      }),
  )

export const swipes = (selector: string, path: readonly number[], stepMs = SWIPE_STEP_MS) =>
  Effect.flatMap(element(selector), (target) =>
    Effect.gen(function* () {
      const [first = 0, ...rest] = path

      dispatchPointer('pointerdown', target, first)

      for (const clientX of rest) {
        yield* pause(stepMs)
        dispatchPointer('pointermove', target, clientX)
      }

      yield* pause(stepMs)
      dispatchPointer('pointerup', target, path.at(-1) ?? 0)
    }),
  )

export const pressesDown = (name: string | RegExp) =>
  Effect.flatMap(role(name), (target) =>
    attempt(`presses ${String(name)}`, () => pointerUser().pointer({ keys: '[TouchA>]', target })),
  )

export const dispatchPointer = (
  type: string,
  target: EventTarget,
  clientX: number,
  clientY = 0,
): void => {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'touch',
    clientX,
    clientY,
  })

  Object.defineProperty(event, 'pageX', { value: clientX })
  Object.defineProperty(event, 'pageY', { value: clientY })
  target.dispatchEvent(event)
}
