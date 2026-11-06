import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdView } from '@crook/domain/HerdView'
import type { HerdMachine } from '@crook/domain/HerdView'
import { HubStorageFailed } from '@crook/protocol/ClientApi'
import { ANNOUNCED } from '@crook/web/rpc/HubLinkState'

import { liveWith, stateWith } from '../../test/AppWiring.tsx'
import { agent, DESK, LAPTOP, machine } from '../../test/HerdFixtures.ts'
import { MACHINE_PATH, MACHINES_PATH } from '../Fixtures.ts'
import { pressesEvenIfHidden, pressesInstantly, seesText, swipes } from '../StageDom.ts'
import { linkStory, step } from '../Story.tsx'
import type { LinkStage, StoryMaker } from '../Story.tsx'

const OFFLINE_HINT = 'Swipe to forget, or wait for it to reconnect'
const DESK_PATH = '/machines/desk'
const HOLD_TO_FORGET = 'Hold to forget desk'
const SWIPE_LEFT = [200, 190, 180, 170, 160, 150]
const DESK_CARD = '[data-slot="swipe-card"]'

const viewOf = (machines: readonly HerdMachine[]) =>
  new HerdView({ machines, hubVersion: CrookVersion.make('0.1.0') })

const laptop = machine(
  LAPTOP,
  [
    agent('w1:p1', 'working', { title: 'Port the herd screen' }),
    agent('w1:p2', 'blocked', { title: 'Wire the hub link' }),
  ],
  { agentVersion: '0.0.9', herdrVersion: '0.9.5' },
)

const current = machine(LAPTOP, [agent('w1:p1', 'idle', { title: 'Port the herd screen' })], {
  agentVersion: '0.1.0',
  herdrVersion: '0.9.5',
})

const desk = machine(DESK, [agent('w2:p1', 'working', { title: 'Hidden while offline' })], {
  connection: 'offline',
  agentVersion: '0.1.0',
})

const reconnecting = machine(DESK, [agent('w2:p1', 'working', { title: 'Dimmed for a moment' })], {
  connection: 'reconnecting',
  agentVersion: '0.1.0',
})

const refusal = new HubStorageFailed({ detail: 'disk full' })

const refuseForget = ({ link }: LinkStage) => Ref.set(link.forgetRefusal, Option.some(refusal))

export const MACHINES_STORIES: readonly StoryMaker[] = [
  linkStory({
    slug: 'skeleton',
    title: 'Machines, the skeleton of a first visit',
    path: MACHINES_PATH,
    link: stateWith(ANNOUNCED, Option.none()),
    shows: { selector: '[data-slot="machines-skeleton"]' },
  }),
  linkStory({
    slug: 'list',
    title: 'Machines, online, offline and behind on version',
    path: MACHINES_PATH,
    link: liveWith(viewOf([laptop, desk])),
    shows: { text: OFFLINE_HINT },
  }),
  linkStory({
    slug: 'current-versions',
    title: 'Machines, nothing to update',
    path: MACHINES_PATH,
    link: liveWith(viewOf([current])),
    shows: { text: 'laptop' },
  }),
  linkStory({
    slug: 'empty',
    title: 'Machines, none yet',
    path: MACHINES_PATH,
    link: liveWith(viewOf([])),
    shows: { text: 'No machines yet' },
  }),
  linkStory({
    slug: 'reconnecting',
    title: 'Machines, one reconnecting',
    path: MACHINES_PATH,
    link: liveWith(viewOf([laptop, reconnecting])),
    shows: { text: 'desk' },
  }),
  linkStory({
    slug: 'swipe-open',
    title: 'Machines, offline card swiped open',
    shows: { selector: '[data-slot="swipe-actions"]:not([inert])' },
    path: MACHINES_PATH,
    link: liveWith(viewOf([desk])),
    settle: () => Effect.andThen(seesText(OFFLINE_HINT), swipes(DESK_CARD, SWIPE_LEFT)),
  }),
  linkStory({
    slug: 'forget-pending',
    title: 'Machines, Forget waiting on the hub',
    shows: { selector: '[data-slot="swipe-actions"] button[disabled]' },
    path: MACHINES_PATH,
    link: liveWith(viewOf([desk])),
    arrange: ({ link }) => link.forgetAnswers.close,
    settle: () =>
      Effect.gen(function* () {
        yield* seesText(OFFLINE_HINT)
        yield* swipes(DESK_CARD, SWIPE_LEFT)
        yield* pressesEvenIfHidden('Forget')
      }),
  }),
  linkStory({
    slug: 'forget-failed',
    title: 'Machines, the hub refused a forget',
    path: MACHINES_PATH,
    link: liveWith(viewOf([desk])),
    arrange: refuseForget,
    settle: () => Effect.andThen(seesText(OFFLINE_HINT), pressesEvenIfHidden('Forget')),
    shows: { text: 'could not save that' },
  }),
]

export const MACHINE_STORIES: readonly StoryMaker[] = [
  linkStory({
    slug: 'detail',
    title: 'Machine, with agents and an update pill',
    path: MACHINE_PATH,
    link: liveWith(viewOf([laptop, desk])),
    shows: { text: 'update agent' },
  }),
  linkStory({
    slug: 'reconnecting',
    title: 'Machine, reconnecting and dimmed',
    path: DESK_PATH,
    link: liveWith(viewOf([laptop, reconnecting])),
    shows: { text: 'Dimmed for a moment' },
  }),
  linkStory({
    slug: 'unknown',
    title: 'Machine, one crook does not know',
    path: '/machines/nas',
    link: liveWith(viewOf([laptop])),
    shows: { text: "crook doesn't know this machine" },
  }),
  linkStory({
    slug: 'forget-offered',
    title: 'Machine, offline with Hold to forget',
    path: DESK_PATH,
    link: liveWith(viewOf([laptop, desk])),
    shows: { all: [{ text: HOLD_TO_FORGET }, { absent: 'Agents ·' }] },
  }),
  linkStory({
    slug: 'forget-pending',
    title: 'Machine, forget waiting on the hub',
    shows: { text: 'Forgetting…' },
    path: DESK_PATH,
    link: liveWith(viewOf([laptop, desk])),
    arrange: ({ link }) => link.forgetAnswers.close,
    settle: () => pressesInstantly(HOLD_TO_FORGET),
  }),
  linkStory({
    slug: 'forget-stays-pending',
    title: 'Machine, a slow forget still saying so past the press',
    path: DESK_PATH,
    link: liveWith(viewOf([laptop, desk])),
    shows: { text: HOLD_TO_FORGET },
    ends: { text: 'Forgetting…' },
    arrange: ({ link }) => link.forgetAnswers.close,
    timeline: [
      step<LinkStage>(400, 'Hold to forget', () => pressesInstantly(HOLD_TO_FORGET)),
      step<LinkStage>(1600, 'The hub has not answered', () => Effect.void),
    ],
  }),
  linkStory({
    slug: 'forget-refused',
    title: 'Machine, forget refused',
    path: DESK_PATH,
    link: liveWith(viewOf([laptop, desk])),
    arrange: refuseForget,
    settle: () => pressesInstantly(HOLD_TO_FORGET),
    shows: { text: 'could not save that' },
  }),
  linkStory({
    slug: 'forgotten-while-open',
    title: 'Machine, leaves the herd while open',
    shows: { text: 'Agents · 2' },
    ends: { text: "crook doesn't know this machine" },
    path: MACHINE_PATH,
    link: liveWith(viewOf([laptop, desk])),
    timeline: [
      step<LinkStage>(500, 'The herd loses this machine', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(viewOf([desk]))),
      ),
    ],
  }),
]
