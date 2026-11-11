import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import {
  AttachmentRef,
  attachmentDigestOf,
  FIRST_AGENT_WITH_ATTACHMENTS,
  Prompt,
} from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'
import type { AgentRow } from '@crook/domain/AgentRow'
import { UploadUnreachable } from '@crook/web/rpc/HubUploads'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole, present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { inputDelivered } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { caughtUp, opened } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const LOG_NAME = 'build.log'
const LOG_TEXT = 'step 3 failed'
const OLD_AGENT = '0.0.13'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812

const live = (rows: readonly AgentRow[], agentVersion: string) =>
  liveWith(herd([machine(LAPTOP, rows, { agentVersion })]))

const field = () => present(screen.queryByRole('textbox'), 'The composer')

const pasteLog = () => {
  const file = new File([LOG_TEXT], LOG_NAME, { type: 'application/octet-stream' })

  fireEvent.paste(field(), { clipboardData: { files: [file] } })
}

const logRef = Effect.map(
  attachmentDigestOf(new TextEncoder().encode(LOG_TEXT)),
  (digest) =>
    new AttachmentRef({
      name: LOG_NAME,
      mediaType: 'application/octet-stream',
      size: LOG_TEXT.length,
      digest,
    }),
)

const openChat = Effect.fn('openChat')(function* (agentVersion: string) {
  const rendered = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')], agentVersion))
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

describe('a prompt with an attachment', () => {
  it.effect('uploads the file first, sends its reference, and clears it once the hub answers', () =>
    Effect.gen(function* () {
      const { link } = yield* openChat(FIRST_AGENT_WITH_ATTACHMENTS)
      const ref = yield* logRef
      const sent = new Prompt({ pane: PANE, text: 'what broke?', attachments: [ref] })

      yield* Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(sent)))
      pasteLog()
      yield* Effect.promise(() => screen.findByText(LOG_NAME))
      fireEvent.change(field(), { target: { value: 'what broke?' } })
      yield* click(yield* findByRole('button', 'Send'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((command) => command.command)).toEqual([sent])
      })

      expect(Ref.getUnsafe(link.uploads.uploaded)).toEqual([
        { machine: LAPTOP, digest: ref.digest },
      ])

      yield* eventually(() => {
        expect(screen.queryByRole('button', { name: `Remove ${LOG_NAME}` })).toBeNull()
      })
    }),
  )

  it.effect('sends with no words at all', () =>
    Effect.gen(function* () {
      const { link } = yield* openChat(FIRST_AGENT_WITH_ATTACHMENTS)
      const ref = yield* logRef

      pasteLog()
      yield* Effect.promise(() => screen.findByText(LOG_NAME))
      yield* click(yield* findByRole('button', 'Send'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((command) => command.command)).toEqual([
          new Prompt({ pane: PANE, text: '', attachments: [ref] }),
        ])
      })
    }),
  )

  it.effect('sends nothing and keeps the file when the upload fails', () =>
    Effect.gen(function* () {
      const { link } = yield* openChat(FIRST_AGENT_WITH_ATTACHMENTS)
      const failure = new UploadUnreachable({ detail: 'offline' })

      yield* Ref.set(link.uploads.uploadRefusal, Option.some(failure))
      pasteLog()
      yield* Effect.promise(() => screen.findByText(LOG_NAME))
      yield* click(yield* findByRole('button', 'Send'))
      yield* Effect.promise(() => screen.findByText(failure.message))

      expect(Ref.getUnsafe(link.sent)).toEqual([])
      expect(screen.queryByRole('button', { name: `Remove ${LOG_NAME}` })).not.toBeNull()
    }),
  )

  it.effect('refuses a command that carries one', () =>
    Effect.gen(function* () {
      const { link } = yield* openChat(FIRST_AGENT_WITH_ATTACHMENTS)

      pasteLog()
      yield* Effect.promise(() => screen.findByText(LOG_NAME))
      fireEvent.change(field(), { target: { value: '/compact' } })
      yield* click(yield* findByRole('button', 'Send'))
      yield* Effect.promise(() => screen.findByText(/A command cannot carry attachments/u))

      expect(Ref.getUnsafe(link.sent)).toEqual([])
    }),
  )

  it.effect('says to update an agent too old to take one, and attaches nothing', () =>
    Effect.gen(function* () {
      yield* openChat(OLD_AGENT)

      pasteLog()
      yield* Effect.promise(() => screen.findByText(/too old to take attachments/u))

      expect(screen.queryByText(LOG_NAME)).toBeNull()
    }),
  )
})
