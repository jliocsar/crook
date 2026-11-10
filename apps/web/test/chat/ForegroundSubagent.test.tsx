import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import { afterEach, beforeEach, vi } from 'vitest'

import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript, SubagentsChanged } from '@crook/domain/Transcript'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import {
  chunk,
  opened,
  prompt,
  REVIEWER,
  SESSION,
  subagent,
  toolUse,
} from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(DateTime.addDuration(START, Duration.minutes(5)).epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a foreground subagent running', () => {
  it.effect('is one tap away from the dock, with nothing about it in the header', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp(
        CHAT,
        liveWith(herd([machine(LAPTOP, [agent('w1:p1', 'working')])])),
      )
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 20, [
          prompt(0, 'Review the diff'),
          toolUse(10, 'toolu_1', 'Agent', {
            description: 'Review the herd diff',
            prompt: 'Read the diff and list the risks.',
            subagent_type: 'code-reviewer',
          }),
        ]),
        new SubagentsChanged({
          session: SESSION,
          subagents: [subagent({ toolUseId: 'toolu_1', background: false })],
        }),
      ])

      const chip = yield* findByRole('button', 'Review the herd diff, running')

      expect(document.querySelector('header')?.textContent).not.toContain('running')
      expect(
        screen.getByText('Review the herd diff', { selector: '[data-slot="subagent-tree"] *' }),
      ).toBeDefined()

      yield* click(chip)
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe(
          `/m/laptop/p/w1%3Ap1/sub/${SESSION}/${REVIEWER}`,
        )
      })
    }),
  )
})
