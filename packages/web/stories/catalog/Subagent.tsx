import * as Effect from 'effect/Effect'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { SubagentsChanged } from '@crook/domain/Transcript'
import { TranscriptReadFailed } from '@crook/protocol/Transcripts'

import { liveWith } from '../../test/AppWiring.tsx'
import { herd, LAPTOP, machine } from '../../test/HerdFixtures.ts'
import {
  answered,
  caughtUp,
  chunk,
  opened,
  prompt,
  said,
  SESSION,
  subagent,
  toolResult,
  toolUse,
} from '../../test/TranscriptFixtures.ts'
import { chatHerd, opensWith } from '../ChatFixtures.ts'
import {
  chatAgent,
  feed,
  REVIEW_LAUNCH,
  REVIEW_LINES,
  SUBAGENT_PATH,
  SUBAGENT_SOURCE,
} from '../Fixtures.ts'
import { linkStory, step } from '../Story.tsx'
import type { LinkStage, LinkStorySpec, StoryMaker } from '../Story.tsx'
import type { TranscriptEvent } from '@crook/domain/Transcript'
import { role, seesText } from '../StageDom.ts'

const WORKING_LIVE = liveWith(chatHerd(chatAgent('working')))
const NO_MESSAGES_NOTE = 'Subagents take no messages'

const story = (
  spec: Omit<LinkStorySpec, 'path' | 'link' | 'arrange'> & {
    readonly parent?: readonly TranscriptEvent[]
    readonly own?: readonly TranscriptEvent[]
    readonly link?: LinkStorySpec['link']
    readonly arrange?: (stage: LinkStage) => Effect.Effect<void>
  },
) =>
  linkStory({
    ...spec,
    path: SUBAGENT_PATH,
    link: spec.link ?? WORKING_LIVE,
    arrange: (stage) =>
      Effect.gen(function* () {
        yield* feed(stage.link, spec.parent ?? REVIEW_LAUNCH)
        yield* feed(stage.link, spec.own ?? [], SUBAGENT_SOURCE)
        yield* spec.arrange === undefined ? Effect.void : spec.arrange(stage)
      }),
  })

const finishedRoster = new SubagentsChanged({
  session: SESSION,
  subagents: [subagent({ toolUseId: 'toolu_review', status: 'completed' })],
})

export const SUBAGENT_STORIES: readonly StoryMaker[] = [
  story({
    slug: 'running',
    title: 'Subagent, running with its lines',
    own: REVIEW_LINES,
    shows: { text: 'Two risks found.' },
  }),
  story({
    slug: 'empty-loading',
    title: 'Subagent, nothing read yet',
    shows: { text: NO_MESSAGES_NOTE },
  }),
  story({
    slug: 'no-messages',
    title: 'Subagent, opened with no lines',
    own: [opened(), caughtUp(0)],
    shows: { text: 'Read the diff and list the risks.' },
  }),
  story({
    slug: 'run-unknown',
    title: 'Subagent, a run the parent does not list',
    parent: [opened(), caughtUp(0)],
    own: REVIEW_LINES,
    shows: { text: 'Two risks found.' },
  }),
  story({
    slug: 'tool-running',
    title: 'Subagent, a tool running',
    own: opensWith([
      prompt(0, 'Read the diff'),
      toolUse(10, 'toolu_grep', 'Grep', { pattern: 'beginAttempt' }),
    ]),
    shows: { selector: '[data-slot="tool-call"]' },
  }),
  story({
    slug: 'turn-with-tools',
    title: 'Subagent, a run of tool calls, the Working row holding its place',
    own: opensWith([prompt(0, 'Read the diff', 1)]),
    shows: { text: 'Read the diff and list the risks.' },
    ends: {
      all: [
        { text: 'That is the whole review.' },
        { selector: '[data-machine="activity"][data-state="NoAgent"]' },
      ],
    },
    timeline: [
      step<LinkStage>(500, 'Grep starts', ({ link }) =>
        feed(
          link,
          [chunk(10, 20, [toolUse(10, 'toolu_grep', 'Grep', { pattern: 'attempt' }, 2)])],
          SUBAGENT_SOURCE,
        ),
      ),
      step<LinkStage>(800, 'Grep ends', ({ link }) =>
        feed(
          link,
          [chunk(20, 30, [toolResult(20, 'toolu_grep', 'src/rpc/HubLink.ts:64', { seconds: 3 })])],
          SUBAGENT_SOURCE,
        ),
      ),
      step<LinkStage>(300, 'Bash starts', ({ link }) =>
        feed(
          link,
          [chunk(30, 40, [toolUse(30, 'toolu_bash', 'Bash', { command: 'git diff' }, 4)])],
          SUBAGENT_SOURCE,
        ),
      ),
      step<LinkStage>(800, 'Bash ends', ({ link }) =>
        feed(
          link,
          [chunk(40, 50, [toolResult(40, 'toolu_bash', 'two files', { seconds: 5 })])],
          SUBAGENT_SOURCE,
        ),
      ),
      step<LinkStage>(800, 'Its answer lands', ({ link }) =>
        feed(
          link,
          [chunk(50, 60, [answered(50, 'That is the whole review.', 6)])],
          SUBAGENT_SOURCE,
        ),
      ),
      step<LinkStage>(500, 'The parent says the run finished', ({ link }) =>
        feed(link, [finishedRoster]),
      ),
    ],
  }),
  story({
    slug: 'finished',
    title: 'Subagent, finished',
    parent: [...REVIEW_LAUNCH, finishedRoster],
    own: [
      opened(),
      chunk(0, 20, [said(0, 'Two risks found.'), answered(10, 'That is the whole review.')]),
      caughtUp(20),
    ],
    shows: { text: 'That is the whole review.' },
  }),
  story({
    slug: 'failed-watch',
    title: 'Subagent, its watch failed',
    settle: ({ link }) =>
      Effect.gen(function* () {
        const failure = new TranscriptReadFailed({ detail: 'disk unplugged' })

        yield* seesText(NO_MESSAGES_NOTE)
        yield* link.endTranscript(SUBAGENT_SOURCE, failure)
        yield* role('Try again')
      }),
    shows: { text: 'Try again' },
  }),
  story({
    slug: 'pane-closed',
    title: 'Subagent, the pane it ran in closed',
    shows: {
      all: [
        { text: 'pane closed' },
        { absent: 'failed' },
        { selector: '[data-run][data-status="pane closed"]' },
      ],
    },
    own: REVIEW_LINES,
    settle: ({ link }) =>
      Effect.andThen(
        seesText('Two risks found.'),
        SubscriptionRef.set(link.state, liveWith(herd([machine(LAPTOP, [])]))),
      ),
  }),
  story({
    slug: 'away',
    title: 'Subagent, the machine is offline',
    link: liveWith(chatHerd(chatAgent('working'), 'offline')),
    own: REVIEW_LINES,
    shows: { text: 'Two risks found.' },
  }),
]
