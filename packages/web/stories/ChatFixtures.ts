import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Ref from 'effect/Ref'

import type { AgentRow } from '@crook/domain/AgentRow'
import { Prompt } from '@crook/domain/Command'
import type { TranscriptEvent, TranscriptSource } from '@crook/domain/Transcript'

import { liveWith } from '../test/AppWiring.tsx'
import { agent, herd, LAPTOP, machine } from '../test/HerdFixtures.ts'
import type { MachineConnection } from '@crook/domain/Machine'
import { inputDelivered } from '../test/HubFakes.ts'
import { caughtUp, chunk, opened } from '../test/TranscriptFixtures.ts'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import { CHAT_PATH, CHAT_TITLE, chatAgent, feed, PANE } from './Fixtures.ts'
import { linkStory } from './Story.tsx'
import type { LinkStage, LinkStorySpec, StoryMaker } from './Story.tsx'

export const COMPOSER_FIELD = 'textarea'
export const SEND_READY = '[data-slot="prompt-input-submit"]:not([disabled])'
export const THREAD_ROW = '[data-row]'

export const chatHerd = (row: AgentRow = chatAgent(), connection: MachineConnection = 'online') =>
  herd([
    machine(LAPTOP, [row], {
      connection,
      agentVersion: '0.0.1',
      herdrVersion: '0.9.5',
    }),
  ])

export const idleChat = liveWith(chatHerd())

export const shellOnlyHerd = (pane = 'w1:p1') =>
  herd([machine(LAPTOP, [], { shellPanes: [pane], agentVersion: '0.0.1' })])

export const delivered = ({ link }: LinkStage, text: string) =>
  Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text }))))

export const opensWith = (messages: readonly TranscriptMessage[]): readonly TranscriptEvent[] => [
  opened(),
  chunk(0, messages.length * 10, messages),
  caughtUp(messages.length * 10),
]

export const chatStory = (
  spec: Omit<LinkStorySpec, 'path' | 'link' | 'arrange'> & {
    readonly row?: AgentRow
    readonly link?: LinkStorySpec['link']
    readonly events?: readonly TranscriptEvent[]
    readonly source?: TranscriptSource
    readonly arrange?: (stage: LinkStage) => Effect.Effect<void>
  },
): StoryMaker =>
  linkStory({
    ...spec,
    path: CHAT_PATH,
    link: spec.link ?? liveWith(chatHerd(spec.row ?? chatAgent())),
    arrange: (stage) =>
      Effect.gen(function* () {
        yield* feed(stage.link, spec.events ?? [], spec.source)
        yield* spec.arrange === undefined ? Effect.void : spec.arrange(stage)
      }),
  })

export const titledAgent = (status: AgentRow['status']) =>
  agent('w1:p1', status, { title: CHAT_TITLE, secondsAgo: 42 })
