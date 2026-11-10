import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach } from 'vitest'

import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'

import { liveWith, renderApp } from '../AppRender.tsx'
import { wait } from '../Dom.ts'
import { agent, herd, LAPTOP, machine } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { RENDER_COUNTS } from '../RenderCounter.ts'
import { phoneViewport } from '../ThreadRender.tsx'
import { caughtUp, chunk, opened, said } from '../TranscriptFixtures.ts'

const CHAT = '/m/laptop/p/w1:p1'
const SETTLE_MS = 50
const PAST_THE_THREAD_SETTLING_MS = 1000
const KEYSTROKES = ['a', 'ab', 'abc', 'abcd', 'abcde']
const LONG_DRAFT = 'a line\nanother line\nand a third one\n'

const laptop = machine(LAPTOP, [agent('w1:p1', 'idle')], { agentVersion: '0.0.2' })

const field = () => screen.getByRole<HTMLTextAreaElement>('textbox')

const threadRenders = () => RENDER_COUNTS.get('ThreadBody') ?? RENDER_COUNTS.get('Thread') ?? 0

const opensChat = Effect.gen(function* () {
  phoneViewport()

  const { link } = yield* renderApp(CHAT, liveWith(herd([laptop])))
  const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PaneId.make('w1:p1') }))

  yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [said(0, 'A line.')]), caughtUp(10)])
  yield* Effect.promise(() => screen.findByText('A line.'))
  yield* wait(PAST_THE_THREAD_SETTLING_MS)
})

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
})

describe('typing a draft', () => {
  it.effect('renders nothing of the thread', () =>
    Effect.gen(function* () {
      yield* opensChat

      const before = threadRenders()

      yield* Effect.forEach(
        KEYSTROKES,
        (value) =>
          Effect.sync(() => {
            fireEvent.change(field(), { target: { value } })
          }).pipe(Effect.andThen(wait(SETTLE_MS))),
        { discard: true },
      )

      expect(threadRenders() - before).toBe(0)
      expect(field().value).toBe('abcde')
    }),
  )

  it.effect('leaves the field to the layout, so it never collapses to measure itself', () =>
    Effect.gen(function* () {
      yield* opensChat

      fireEvent.change(field(), { target: { value: LONG_DRAFT } })
      yield* wait(SETTLE_MS)

      expect(field().style.height).toBe('')
      expect(field().parentElement?.firstElementChild?.getAttribute('data-fit-text')).toBe(
        `${LONG_DRAFT} `,
      )
    }),
  )
})
