import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import { afterEach, beforeEach, vi } from 'vitest'

import type { AgentRow } from '@crook/domain/AgentRow'
import { Prompt } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript, SubagentsChanged } from '@crook/domain/Transcript'
import { SubagentLaunch } from '@crook/domain/TranscriptMessage'

import { liveWith, renderApp } from '../AppRender.tsx'
import {
  fingerScrollsToTop,
  followedToBottom,
  isFollowing,
  manyLines,
  tallViewport,
} from '../ChatThread.ts'
import { bottomOf, click, eventually, findByRole, present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine } from '../HerdFixtures.ts'
import { inputDelivered } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import {
  chunk,
  opened,
  prompt,
  REVIEWER,
  SESSION,
  subagent,
  toolResult,
  toolUse,
} from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const IN_SUBAGENT_TREE = '[data-slot="subagent-tree"] *'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812

const live = (rows: readonly AgentRow[]) => liveWith(herd([machine(LAPTOP, rows)]))

const field = () => present(screen.queryByRole('textbox'), 'The composer')

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the chat thread following the end', () => {
  it.effect('goes back to the end of the thread when a prompt is sent from further up', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: 'Run the tests' }))),
      )
      yield* Queue.offer(transcript, opened())

      const viewport = tallViewport()

      yield* Queue.offer(transcript, manyLines(0))
      yield* followedToBottom(viewport)
      fingerScrollsToTop(viewport)

      expect(isFollowing(viewport)).toBe(false)

      yield* Effect.promise(() => userEvent.type(field(), 'Run the tests{Enter}'))

      expect(viewport.scrollTop).toBe(bottomOf(viewport))
      expect(isFollowing(viewport)).toBe(true)
    }),
  )

  it.effect('goes back to the end of the thread when coming back from a subagent', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 30, [
          prompt(0, 'Review the diff'),
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

      const viewport = tallViewport()

      yield* Queue.offer(transcript, manyLines(30))
      yield* followedToBottom(viewport)
      fingerScrollsToTop(viewport)
      yield* click(
        present(
          (yield* Effect.promise(() =>
            screen.findByText('Review the herd diff', { selector: IN_SUBAGENT_TREE }),
          )).closest('button'),
          'The subagent row',
        ),
      )
      yield* click(yield* findByRole('button', 'Back to Agent in w1:p1'))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe(CHAT)
      })

      expect(viewport.scrollTop).toBe(bottomOf(viewport))
      expect(isFollowing(viewport)).toBe(true)
    }),
  )
})
