import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import type { AgentRow } from '@crook/domain/AgentRow'
import { AgentStarted } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript, SubagentsChanged } from '@crook/domain/Transcript'
import { SubagentLaunch } from '@crook/domain/TranscriptMessage'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole, present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { STARTED_PANE } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import {
  chunk,
  opened,
  REVIEWER,
  SESSION,
  subagent,
  toolResult,
  toolUse,
} from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const PANE_PATH = '/machines/laptop/p/w1%3Ap1'
const IN_SUBAGENT_TREE = '[data-slot="subagent-tree"] *'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812

const live = (rows: readonly AgentRow[]) => liveWith(herd([machine(LAPTOP, rows)]))

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

describe('a chat opened from a machine screen', () => {
  it.effect('names the machine on Back when the chat was opened from it', () =>
    Effect.gen(function* () {
      yield* renderApp(
        '/machines/laptop',
        live([agent('w1:p1', 'idle', { title: 'Port the herd' })]),
      )

      yield* click(yield* Effect.promise(() => screen.findByText('Port the herd')))

      expect(yield* findByRole('button', 'Back to laptop')).toBeDefined()
    }),
  )

  it.effect('replaces a chat opened from its machine in place, still over that machine', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp(PANE_PATH, live([agent('w1:p1', 'idle')]))

      yield* Effect.promise(() => screen.findByRole('textbox'))
      yield* Ref.set(link.commandAnswer, Exit.succeed(new AgentStarted({ pane: STARTED_PANE })))
      yield* SubscriptionRef.set(link.state, live([]))
      yield* click(yield* findByRole('button', 'Start Claude here again'))
      yield* SubscriptionRef.set(link.state, live([agent(STARTED_PANE, 'idle')]))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/machines/laptop/p/w1%3Ap9')
      })
    }),
  )

  it.effect('pushes a subagent over a chat opened from its machine, under that machine', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp(PANE_PATH, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 30, [
          toolUse(10, 'toolu_1', 'Agent', {
            description: 'Review the herd diff',
            prompt: 'Read the diff and list the risks.',
            subagent_type: 'code-reviewer',
          }),
          toolResult(20, 'toolu_1', 'Async agent launched', {
            launch: new SubagentLaunch({ subagent: REVIEWER, status: 'async_launched' }),
          }),
        ]),
        new SubagentsChanged({ session: SESSION, subagents: [subagent({ toolUseId: 'toolu_1' })] }),
      ])
      yield* findByRole('button', '1 running, show details')
      yield* click(
        present(
          (yield* Effect.promise(() =>
            screen.findByText('Review the herd diff', { selector: IN_SUBAGENT_TREE }),
          )).closest('button'),
          'The subagent row',
        ),
      )
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe(
          `/machines/laptop/p/w1%3Ap1/sub/${SESSION}/${REVIEWER}`,
        )
      })
    }),
  )
})
