import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { AgentStarted } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import { Checkout, Place } from '@crook/domain/Place'
import { CommandTimedOut } from '@crook/protocol/Commands'

import { liveWith } from '../../test/AppWiring.tsx'
import { agent, DESK, herd, LAPTOP, machine, START } from '../../test/HerdFixtures.ts'
import { NEW_AGENT_PATH } from '../Fixtures.ts'
import { clicks, seesText, types } from '../StageDom.ts'
import { linkStory, step } from '../Story.tsx'
import type { LinkStage, LinkStorySpec, StoryMaker } from '../Story.tsx'

const START_READY = 'button[aria-label="Start Claude"]:not([disabled])'
const CROOK = '/home/jliocsar/Projects/crook'
const DOTFILES = '/home/jliocsar/dotfiles'
const NEW_PANE = PaneId.make('w1:p9')
const TASK = 'Fix the banner'
const TASK_FIELD = 'First message to Claude'
const START_CLAUDE = 'Start Claude'
const COMMAND_TIMEOUT_SECONDS = 45

const place = (folder: string, minutesAgo: number, branch: string) =>
  new Place({
    folder,
    checkout: Option.some(new Checkout({ branch: Option.some(branch) })),
    usedAt: DateTime.subtractDuration(START, Duration.minutes(minutesAgo)),
  })

const running = [agent('w1:p1', 'working', { title: 'Port the herd screen' })]

const laptop = machine(LAPTOP, running, {
  places: [place(CROOK, 5, 'main'), place(DOTFILES, 90, 'master')],
})

const laptopWithNewAgent = machine(
  LAPTOP,
  [...running, agent(NEW_PANE, 'unknown', { title: TASK })],
  { places: [place(CROOK, 0, 'main')] },
)

const desk = machine(DESK, [], { places: [place(DOTFILES, 60, 'master')] })

const offlineDesk = machine(DESK, [], { connection: 'offline' })

const noPlaces = machine(LAPTOP, [])

const started = Exit.succeed(new AgentStarted({ pane: NEW_PANE }))

const timedOut = Exit.fail(
  new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(COMMAND_TIMEOUT_SECONDS) }),
)

const story = (spec: Omit<LinkStorySpec, 'path'>) => linkStory({ ...spec, path: NEW_AGENT_PATH })

export const NEW_AGENT_STORIES: readonly StoryMaker[] = [
  story({
    slug: 'starts-in-checkout',
    title: 'New agent, starts in the checkout',
    link: liveWith(herd([laptop, desk])),
    shows: { text: 'Claude starts in crook' },
  }),
  story({
    slug: 'no-machines',
    title: 'New agent, no machines',
    link: liveWith(herd([])),
    shows: { text: 'No machines yet' },
  }),
  story({
    slug: 'all-offline',
    title: 'New agent, every machine offline',
    link: liveWith(herd([machine(LAPTOP, [], { connection: 'offline' })])),
    shows: { text: 'Every machine is offline' },
  }),
  story({
    slug: 'machine-offline',
    title: 'New agent, the chosen machine went offline',
    link: liveWith(herd([laptop, desk])),
    settle: ({ link }) =>
      Effect.andThen(
        seesText('Claude starts in crook'),
        SubscriptionRef.set(
          link.state,
          liveWith(herd([machine(LAPTOP, running, { connection: 'offline' }), desk])),
        ),
      ),
    shows: { text: 'laptop is offline' },
  }),
  story({
    slug: 'pick-folder',
    title: 'New agent, pick a folder',
    link: liveWith(herd([noPlaces])),
    shows: { text: 'Pick a folder on laptop' },
  }),
  story({
    slug: 'machine-picker',
    title: 'New agent, machine picker with an offline machine',
    link: liveWith(herd([laptop, offlineDesk])),
    settle: () => clicks('Machine, laptop'),
    shows: { selector: '[role="dialog"]' },
  }),
  story({
    slug: 'folder-picker',
    title: 'New agent, folder picker',
    link: liveWith(herd([laptop])),
    settle: () => clicks('Folder, crook'),
    shows: { selector: '[role="dialog"]' },
  }),
  story({
    slug: 'folder-invalid',
    title: 'New agent, a folder path that is not one',
    link: liveWith(herd([noPlaces])),
    settle: () =>
      Effect.andThen(clicks('Folder, Pick a folder'), types('Folder path', '~/Projects/crook')),
    shows: { text: 'Type the full path, starting with /.' },
  }),
  story({
    slug: 'branch-picker',
    title: 'New agent, branch picker',
    link: liveWith(herd([laptop])),
    settle: () => clicks('Branch, main'),
    shows: { selector: '[role="dialog"]' },
  }),
  story({
    slug: 'worktree-picker',
    title: 'New agent, new worktree in the branch picker',
    link: liveWith(herd([laptop])),
    settle: () =>
      Effect.gen(function* () {
        yield* types(TASK_FIELD, TASK)
        yield* clicks('Branch, main')
        yield* clicks(/New worktree/u)
      }),
    shows: { selector: '[role="dialog"]' },
  }),
  story({
    slug: 'worktree-invalid',
    title: 'New agent, a branch name git refuses',
    link: liveWith(herd([laptop])),
    settle: () =>
      Effect.gen(function* () {
        yield* clicks('Branch, main')
        yield* clicks(/New worktree/u)
        yield* types('Branch name', 'has spaces and..dots')
      }),
    shows: { selector: '[role="dialog"]' },
  }),
  story({
    slug: 'starts-new-worktree',
    title: 'New agent, starts in a named worktree',
    link: liveWith(herd([laptop])),
    settle: () =>
      Effect.gen(function* () {
        yield* types(TASK_FIELD, TASK)
        yield* clicks('Branch, main')
        yield* clicks(/New worktree/u)
        yield* clicks('Done')
      }),
    shows: { text: 'in a new worktree on' },
  }),
  story({
    slug: 'starts-unnamed-worktree',
    title: 'New agent, a worktree with no name yet',
    shows: { text: 'in a new worktree once its branch has a name' },
    link: liveWith(herd([laptop])),
    settle: () =>
      Effect.gen(function* () {
        yield* clicks('Branch, main')
        yield* clicks(/New worktree/u)
        yield* clicks('Done')
      }),
  }),
  story({
    slug: 'typed',
    title: 'New agent, a task typed',
    shows: { selector: START_READY },
    link: liveWith(herd([laptop, desk])),
    settle: () => types(TASK_FIELD, TASK),
  }),
  story({
    slug: 'starting',
    title: 'New agent, Starting Claude',
    link: liveWith(herd([laptop, desk])),
    arrange: ({ link }) =>
      Effect.andThen(Ref.set(link.commandAnswer, started), link.commandAnswers.close),
    settle: () => Effect.andThen(types(TASK_FIELD, TASK), clicks(START_CLAUDE)),
    shows: { text: 'Starting Claude…' },
  }),
  story({
    slug: 'opening',
    title: 'New agent, Opening the chat',
    link: liveWith(herd([laptop, desk])),
    arrange: ({ link }) => Ref.set(link.commandAnswer, started),
    settle: () => Effect.andThen(types(TASK_FIELD, TASK), clicks(START_CLAUDE)),
    shows: { text: 'Opening the chat…' },
  }),
  story({
    slug: 'failed',
    title: 'New agent, the start failed',
    link: liveWith(herd([laptop, desk])),
    arrange: ({ link }) => Ref.set(link.commandAnswer, timedOut),
    settle: () => Effect.andThen(types(TASK_FIELD, TASK), clicks(START_CLAUDE)),
    shows: { selector: '[role="alert"]' },
  }),
  story({
    slug: 'start-to-chat',
    title: 'New agent, Start through to the chat',
    shows: { selector: START_READY },
    ends: { text: 'Loading the conversation' },
    link: liveWith(herd([laptop, desk])),
    arrange: ({ link }) =>
      Effect.andThen(Ref.set(link.commandAnswer, started), link.commandAnswers.close),
    settle: () => types(TASK_FIELD, TASK),
    timeline: [
      step<LinkStage>(400, 'Tap Start Claude', () => clicks(START_CLAUDE)),
      step<LinkStage>(
        900,
        'The hub answers, the pane is not in the herd yet',
        ({ link }) => link.commandAnswers.open,
      ),
      step<LinkStage>(900, 'The herd shows the new pane', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(herd([laptopWithNewAgent, desk]))),
      ),
    ],
  }),
]
