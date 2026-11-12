import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as HashMap from 'effect/HashMap'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import { attachmentDigestOf, FIRST_AGENT_WITH_ATTACHMENTS, Prompt } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'
import { CommandTimedOut } from '@crook/protocol/Commands'
import { ComposerDraft, DraftKey } from '@crook/web/cache/DraftCache'
import type { DraftAttachment } from '@crook/web/chat/Attachments'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole, present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { type FakeHubLink, inputDelivered } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { caughtUp, opened } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const KEY = new DraftKey({ machine: LAPTOP, pane: PANE })
const LOG_NAME = 'build.log'
const LOG_TEXT = 'step 3 failed'
const KEPT_TEXT = 'what broke in step 3?'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812
const COMMAND_TIMEOUT_SECONDS = 10

const field = () => present(screen.queryByRole<HTMLTextAreaElement>('textbox'), 'The composer')

const headOf = (link: FakeHubLink) =>
  Ref.getUnsafe(link.draftStore.entries).get(JSON.stringify(['draft', LAPTOP, PANE]))?.stored

const logAttachment = Effect.map(
  attachmentDigestOf(new TextEncoder().encode(LOG_TEXT)),
  (digest): DraftAttachment => ({
    id: 'a1',
    name: LOG_NAME,
    mediaType: 'text/plain',
    kind: 'file',
    bytes: new TextEncoder().encode(LOG_TEXT),
    digest,
  }),
)

const openChat = Effect.fn('openChat')(function* (kept: readonly [DraftKey, ComposerDraft][] = []) {
  const rendered = yield* renderApp(
    CHAT,
    liveWith(
      herd([
        machine(LAPTOP, [agent('w1:p1', 'idle')], { agentVersion: FIRST_AGENT_WITH_ATTACHMENTS }),
      ]),
    ),
    (link) => link.draftStore.seed(HashMap.fromIterable(kept)),
  )
  const transcript = yield* rendered.link.transcriptFor(new PaneTranscript({ pane: PANE }))

  yield* Queue.offerAll(transcript, [opened(), caughtUp(0)])
  yield* Effect.promise(() => screen.findByText('No messages yet'))

  return rendered
})

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

describe('a chat draft', () => {
  it.effect('comes back with its words and attachments when the chat opens', () =>
    Effect.gen(function* () {
      const attachment = yield* logAttachment

      yield* openChat([[KEY, new ComposerDraft({ text: KEPT_TEXT, attachments: [attachment] })]])

      yield* eventually(() => {
        expect(field().value).toBe(KEPT_TEXT)
        expect(screen.queryByRole('button', { name: `Remove ${LOG_NAME}` })).not.toBeNull()
      })
    }),
  )

  it.effect('is kept on the device as it is typed, and is still there after leaving', () =>
    Effect.gen(function* () {
      const { link, router } = yield* openChat()

      fireEvent.change(field(), { target: { value: KEPT_TEXT } })
      yield* eventually(() => {
        expect(headOf(link)).toEqual({ text: KEPT_TEXT, attachments: [] })
      })

      yield* Effect.promise(() => router.navigate({ to: '/' }))
      yield* Effect.promise(() =>
        router.navigate({ to: '/m/$machine/p/$pane', params: { machine: LAPTOP, pane: PANE } }),
      )
      yield* eventually(() => {
        expect(field().value).toBe(KEPT_TEXT)
      })
    }),
  )

  it.effect('is dropped once the hub takes the prompt', () =>
    Effect.gen(function* () {
      const { link } = yield* openChat([
        [KEY, new ComposerDraft({ text: KEPT_TEXT, attachments: [] })],
      ])

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: KEPT_TEXT, attachments: [] }))),
      )
      yield* click(yield* findByRole('button', 'Send'))
      yield* eventually(() => {
        expect(field().value).toBe('')
        expect(Ref.getUnsafe(link.draftStore.entries).size).toBe(0)
      })
    }),
  )

  it.effect('stays when the prompt is refused, so a retry has it', () =>
    Effect.gen(function* () {
      const { link } = yield* openChat([
        [KEY, new ComposerDraft({ text: KEPT_TEXT, attachments: [] })],
      ])
      const timedOut = new CommandTimedOut({
        machine: LAPTOP,
        timeout: Duration.seconds(COMMAND_TIMEOUT_SECONDS),
      })

      yield* Ref.set(link.commandAnswer, Exit.fail(timedOut))
      yield* click(yield* findByRole('button', 'Send'))
      yield* Effect.promise(() => screen.findByText(timedOut.message))

      expect(field().value).toBe(KEPT_TEXT)
      expect(headOf(link)).toEqual({ text: KEPT_TEXT, attachments: [] })
    }),
  )

  it.effect('is dropped when the hub takes the prompt after the chat was left', () =>
    Effect.gen(function* () {
      const { link, router } = yield* openChat([
        [KEY, new ComposerDraft({ text: KEPT_TEXT, attachments: [] })],
      ])

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: KEPT_TEXT, attachments: [] }))),
      )
      yield* link.commandAnswers.close
      yield* click(yield* findByRole('button', 'Send'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent)).toHaveLength(1)
      })
      yield* Effect.promise(() => router.navigate({ to: '/' }))
      yield* eventually(() => {
        expect(screen.queryByRole('textbox')).toBeNull()
      })
      yield* link.commandAnswers.open
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.draftStore.entries).size).toBe(0)
      })

      yield* Effect.promise(() =>
        router.navigate({ to: '/m/$machine/p/$pane', params: { machine: LAPTOP, pane: PANE } }),
      )
      yield* eventually(() => {
        expect(field().value).toBe('')
      })
    }),
  )

  it.effect('stays when the prompt is refused after the chat was left', () =>
    Effect.gen(function* () {
      const { link, router } = yield* openChat([
        [KEY, new ComposerDraft({ text: KEPT_TEXT, attachments: [] })],
      ])
      const timedOut = new CommandTimedOut({
        machine: LAPTOP,
        timeout: Duration.seconds(COMMAND_TIMEOUT_SECONDS),
      })

      yield* Ref.set(link.commandAnswer, Exit.fail(timedOut))
      yield* link.commandAnswers.close
      yield* click(yield* findByRole('button', 'Send'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent)).toHaveLength(1)
      })
      yield* Effect.promise(() => router.navigate({ to: '/' }))
      yield* eventually(() => {
        expect(screen.queryByRole('textbox')).toBeNull()
      })
      yield* link.commandAnswers.open
      yield* Effect.promise(() =>
        router.navigate({ to: '/m/$machine/p/$pane', params: { machine: LAPTOP, pane: PANE } }),
      )
      yield* eventually(() => {
        expect(field().value).toBe(KEPT_TEXT)
      })

      expect(headOf(link)).toEqual({ text: KEPT_TEXT, attachments: [] })
    }),
  )
})
