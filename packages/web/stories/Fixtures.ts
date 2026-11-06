import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Struct from 'effect/Struct'

import { AgentRow } from '@crook/domain/AgentRow'
import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript, SubagentsChanged, SubagentTranscript } from '@crook/domain/Transcript'
import type { TranscriptEvent, TranscriptSource } from '@crook/domain/Transcript'
import { SubagentLaunch } from '@crook/domain/TranscriptMessage'

import { agent, DESK, herd, LAPTOP, machine } from '../test/HerdFixtures.ts'
import {
  answered,
  caughtUp,
  chunk,
  opened,
  prompt,
  REVIEWER,
  said,
  SESSION,
  subagent,
  toolResult,
  toolUse,
} from '../test/TranscriptFixtures.ts'
import type { FakeLink } from './Story.tsx'

export const PANE = PaneId.make('w1:p1')
export const CHAT_PATH = '/m/laptop/p/w1%3Ap1'
export const SUBAGENT_PATH = `/m/laptop/p/w1%3Ap1/sub/${SESSION}/${REVIEWER}`
export const MACHINE_PATH = '/machines/laptop'
export const MACHINES_PATH = '/machines'
export const NEW_AGENT_PATH = '/new'
export const SETTINGS_PATH = '/settings'
export const AGENTS_PATH = '/'
export const CHAT_TITLE = 'Fix the reconnect banner'
export const REVIEW_TITLE = 'Review the herd diff'
export const CHAT_SOURCE = new PaneTranscript({ pane: PANE })
export const SUBAGENT_SOURCE = new SubagentTranscript({ session: SESSION, subagent: REVIEWER })

export const chatAgent = (status: AgentRow['status'] = 'idle', secondsAgo = 42) =>
  agent('w1:p1', status, {
    title: CHAT_TITLE,
    secondsAgo,
    branch: 'fix/reconnect-banner',
    claudeSession: SESSION,
  })

export const chatAgentSaying = (claudeWaiting: boolean) =>
  new AgentRow(Struct.evolve(chatAgent(), { claudeWaiting: () => Option.some(claudeWaiting) }))

export const LAPTOP_MACHINE = machine(
  LAPTOP,
  [
    chatAgent('working'),
    agent('w1:p2', 'blocked', { title: 'Wire the hub link', secondsAgo: 180 }),
    agent('w1:p3', 'done', { title: 'Write the banner', secondsAgo: 600, branch: 'feat/banner' }),
    agent('w1:p4', 'idle', { title: 'Port the herd screen', secondsAgo: 3600 }),
  ],
  { agentVersion: '0.0.1', herdrVersion: '0.9.5' },
)

export const DESK_MACHINE = machine(
  DESK,
  [agent('w2:p1', 'working', { title: 'Run the nightly build', secondsAgo: 900 })],
  { agentVersion: '0.0.1', herdrVersion: '0.9.5' },
)

export const TEAM = herd([LAPTOP_MACHINE, DESK_MACHINE])

export const laptopWith = (rows: readonly AgentRow[]) =>
  herd([machine(LAPTOP, rows, { agentVersion: '0.0.1', herdrVersion: '0.9.5' })])

export const CONVERSATION: readonly TranscriptEvent[] = [
  opened(),
  chunk(0, 40, [
    prompt(0, 'The reconnect banner flashes on every foreground. Can you look?'),
    said(10, 'Reading the link state first.'),
    toolUse(20, 'toolu_read', 'Read', { file_path: 'src/rpc/HubLinkState.ts' }),
    toolResult(30, 'toolu_read', 'export const beginAttempt = LinkStatus.$match({})'),
  ]),
  chunk(40, 50, [answered(40, 'The quiet redial keeps the old notice until the attempt ends.')]),
  caughtUp(50),
]

export const REVIEW_LAUNCH: readonly TranscriptEvent[] = [
  opened(),
  chunk(0, 30, [
    prompt(0, 'Review the diff'),
    toolUse(10, 'toolu_review', 'Agent', {
      description: REVIEW_TITLE,
      prompt: 'Read the diff and list the risks.',
      subagent_type: 'code-reviewer',
    }),
    toolResult(20, 'toolu_review', 'Async agent launched', {
      launch: new SubagentLaunch({ subagent: REVIEWER, status: 'async_launched' }),
    }),
  ]),
  caughtUp(30),
  new SubagentsChanged({ session: SESSION, subagents: [subagent({ toolUseId: 'toolu_review' })] }),
]

export const REVIEW_LINES: readonly TranscriptEvent[] = [
  opened(),
  chunk(0, 10, [said(0, 'Two risks found.')]),
  caughtUp(10),
]

export const feed = (
  link: FakeLink,
  events: readonly TranscriptEvent[],
  source: TranscriptSource = CHAT_SOURCE,
) => Effect.flatMap(link.transcriptFor(source), (transcript) => Queue.offerAll(transcript, events))
