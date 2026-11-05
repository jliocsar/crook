import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'

import { AgentStatus } from '@crook/domain/AgentStatus'
import { RunCommand, PermissionAsk } from '@crook/domain/Ask'
import { AskId } from '@crook/domain/Ids'
import { HubStorageFailed } from '@crook/protocol/ClientApi'

import { liveWith } from '../../test/AppWiring.tsx'
import { agent, DESK, herd, LAPTOP, machine } from '../../test/HerdFixtures.ts'
import { AGENTS_PATH, TEAM } from '../Fixtures.ts'
import {
  clicks,
  dispatchPointer,
  element,
  pause,
  pressesEvenIfHidden,
  seesText,
  swipes,
} from '../StageDom.ts'
import { linkStory } from '../Story.tsx'
import type { LinkStorySpec, StoryMaker } from '../Story.tsx'

const SWIPE_LEFT = [200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100]
const FIRST_SWIPE_CARD = '[data-slot="swipe-card"]'
const PULL_DISTANCE = 200

const LONG_TITLE =
  'Find out why the reconnect banner flashes on every foreground and write down what it would take to stop it'

const lintAsk = new PermissionAsk({
  id: AskId.make('toolu_lint'),
  source: 'hook',
  tool: 'Bash',
  plugin: Option.none(),
  action: new RunCommand({ command: 'bun run lint' }),
  options: [],
  dialog: Option.none(),
})

const herdStory = (spec: Omit<LinkStorySpec, 'path'>) => linkStory({ ...spec, path: AGENTS_PATH })

const statusCards = AgentStatus.literals.map((status) =>
  herdStory({
    slug: `card-${status}`,
    title: `Agent card, ${status}`,
    link: liveWith(
      herd([
        machine(LAPTOP, [agent('w1:p1', status, { title: `A ${status} agent`, secondsAgo: 90 })]),
      ]),
    ),
    shows: { text: `A ${status} agent` },
  }),
)

const pulling = (distance: number) =>
  Effect.flatMap(element('[data-slot="pull-to-resync"]'), (zone) =>
    Effect.sync(() => {
      const touch = (clientY: number) =>
        new Touch({ identifier: 1, target: zone, clientX: 100, clientY })

      zone.dispatchEvent(
        new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch(0)] }),
      )
      zone.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: [touch(distance)],
        }),
      )
    }),
  )

export const HERD_STORIES: readonly StoryMaker[] = [
  herdStory({
    slug: 'full',
    title: 'Agents, two machines at work',
    link: liveWith(TEAM),
    shows: { text: 'Run the nightly build' },
  }),
  herdStory({
    slug: 'no-machines',
    title: 'Agents, no machines yet',
    link: liveWith(herd([])),
    shows: { text: 'No machines yet' },
  }),
  herdStory({
    slug: 'all-offline',
    title: 'Agents, every machine offline',
    link: liveWith(herd([machine(LAPTOP, [], { connection: 'offline' })])),
    shows: { text: 'All machines are offline' },
  }),
  herdStory({
    slug: 'nothing-running',
    title: 'Agents, nothing running',
    link: liveWith(herd([machine(LAPTOP, [])])),
    shows: { text: 'Nothing running' },
  }),
  herdStory({
    slug: 'section-no-agents',
    title: 'Section, a machine with no agents',
    link: liveWith(
      herd([
        machine(LAPTOP, [agent('w1:p1', 'working', { title: 'Port the herd screen' })]),
        machine(DESK, []),
      ]),
    ),
    shows: { text: 'No agents' },
  }),
  herdStory({
    slug: 'section-offline',
    title: 'Section, an offline machine',
    link: liveWith(
      herd([
        machine(LAPTOP, [agent('w1:p1', 'working', { title: 'Port the herd screen' })]),
        machine(DESK, [agent('w2:p1', 'working', { title: 'Hidden' })], {
          connection: 'offline',
        }),
      ]),
    ),
    shows: { text: 'desk' },
  }),
  herdStory({
    slug: 'section-reconnecting',
    title: 'Section, a reconnecting machine',
    link: liveWith(
      herd([
        machine(LAPTOP, [agent('w1:p1', 'working', { title: 'Port the herd screen' })], {
          connection: 'reconnecting',
        }),
      ]),
    ),
    shows: { text: 'Port the herd screen' },
  }),
  herdStory({
    slug: 'section-collapsed',
    title: 'Section, collapsed',
    link: liveWith(TEAM),
    settle: () => clicks(/^laptop/u),
  }),
  ...statusCards,
  herdStory({
    slug: 'card-ask',
    title: 'Agent card, what it asks',
    link: liveWith(
      herd([
        machine(LAPTOP, [
          agent('w1:p1', 'blocked', {
            title: 'Lint the web package',
            ask: lintAsk,
            secondsAgo: 30,
          }),
        ]),
      ]),
    ),
    shows: { text: 'bun run lint' },
  }),
  herdStory({
    slug: 'card-subagents',
    title: 'Agent card, running subagents',
    link: liveWith(
      herd([
        machine(LAPTOP, [
          agent('w1:p1', 'working', {
            title: 'Review the diff',
            branch: 'feat/herd',
            runningSubagents: 3,
          }),
        ]),
      ]),
    ),
    shows: { text: 'Review the diff' },
  }),
  herdStory({
    slug: 'card-pinned',
    title: 'Agent card, pinned',
    link: liveWith(
      herd([
        machine(
          LAPTOP,
          [
            agent('w1:p1', 'working', { title: 'Port the herd screen' }),
            agent('w1:p2', 'idle', { title: 'Pinned to the top' }),
          ],
          { pinned: ['w1:p2'] },
        ),
      ]),
    ),
    shows: { text: 'Pinned to the top' },
  }),
  herdStory({
    slug: 'card-long-title',
    title: 'Agent card, a long title and branch',
    link: liveWith(
      herd([
        machine(LAPTOP, [
          agent('w1:p1', 'working', {
            title: LONG_TITLE,
            branch: 'fix/reconnect-banner-flashes-on-every-foreground-in-the-installed-app',
          }),
        ]),
      ]),
    ),
    shows: { text: LONG_TITLE },
  }),
  herdStory({
    slug: 'many-agents',
    title: 'Agents, a long herd that scrolls',
    link: liveWith(
      herd([
        machine(
          LAPTOP,
          Array.from({ length: 14 }, (_unused, index) =>
            agent(`w1:p${index}`, index % 3 === 0 ? 'working' : 'idle', {
              title: `Agent number ${index}`,
              secondsAgo: index * 60,
            }),
          ),
        ),
      ]),
    ),
    shows: { text: 'Agent number 13' },
  }),
  herdStory({
    slug: 'swipe-open',
    title: 'Agent card, swiped open',
    link: liveWith(TEAM),
    settle: () => swipes(FIRST_SWIPE_CARD, SWIPE_LEFT),
  }),
  herdStory({
    slug: 'swipe-dragging',
    title: 'Agent card, mid swipe',
    link: liveWith(TEAM),
    settle: () =>
      Effect.flatMap(element(FIRST_SWIPE_CARD), (card) =>
        Effect.gen(function* () {
          dispatchPointer('pointerdown', card, 200)

          for (const clientX of [190, 180, 170, 160]) {
            yield* pause(16)
            dispatchPointer('pointermove', card, clientX)
          }
        }),
      ),
  }),
  herdStory({
    slug: 'pin-failure',
    title: 'Agent card, the hub refused a pin',
    link: liveWith(TEAM),
    arrange: ({ link }) =>
      Ref.set(link.pinRefusal, Option.some(new HubStorageFailed({ detail: 'disk full' }))),
    settle: () =>
      Effect.gen(function* () {
        yield* swipes(FIRST_SWIPE_CARD, SWIPE_LEFT)
        yield* pressesEvenIfHidden('Pin')
        yield* seesText('disk full')
      }),
  }),
  herdStory({
    slug: 'pulling',
    title: 'Pull to resync, mid pull',
    note: 'Touch events are constructed by hand, so this one needs a browser with Touch.',
    link: liveWith(TEAM),
    settle: () => pulling(PULL_DISTANCE),
  }),
  herdStory({
    slug: 'add-machine-sheet',
    title: 'Add a machine sheet, from the empty herd',
    link: liveWith(herd([])),
    settle: () => clicks('Add a machine'),
    shows: { selector: '[role="dialog"]' },
  }),
]
