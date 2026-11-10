import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
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
import { agent, DESK, LAPTOP, machine, START } from '../../test/HerdFixtures.ts'
import { MACHINE_PATH, MACHINES_PATH } from '../Fixtures.ts'
import { pressesEvenIfHidden, pressesInstantly, seesText, swipes } from '../StageDom.ts'
import { linkStory, step } from '../Story.tsx'
import type { LinkStage, StoryMaker } from '../Story.tsx'
import { CLOCK_AFTER_START_SECONDS } from '../StoryEnv.ts'

const OFFLINE_HINT = 'Swipe to forget, or wait for it to reconnect'
const DESK_PATH = '/machines/desk'
const HOLD_TO_FORGET = 'Hold to forget desk'
const SWIPE_LEFT = [200, 190, 180, 170, 160, 150]
const DESK_CARD = '[data-slot="swipe-card"]'
const HERDR_LOST = 'herdr lost'
const LOST_FOR = 'lost for'
const UPDATE_AGENT = 'update agent'
const LONG_MACHINE_NAME = 'build-server-in-the-basement-rack-two-west'
const HERDR_ROW_VERSION = '0.9.5'
const CURRENT_AGENT_VERSION = '0.1.0'
const BEHIND_AGENT_VERSION = '0.0.9'
const AGENTS_UNSEEN = "Can't see its agents while herdr is away"
const MACHINE_AGENTS_UNSEEN = "Can't see this machine's agents while herdr is away"

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

const justNow = DateTime.addDuration(START, Duration.seconds(CLOCK_AFTER_START_SECONDS))

const agentsBeforeHerdrWent = [
  agent('w1:p1', 'working', { title: 'Port the herd screen', secondsAgo: 90 }),
  agent('w1:p2', 'idle', { title: 'Wire the hub link', secondsAgo: 600 }),
]

const herdrLost = machine(LAPTOP, agentsBeforeHerdrWent, {
  agentVersion: CURRENT_AGENT_VERSION,
  herdrVersion: HERDR_ROW_VERSION,
  herdrLostAt: START,
})

const herdrLostBehindHub = machine(LAPTOP, agentsBeforeHerdrWent, {
  agentVersion: BEHIND_AGENT_VERSION,
  herdrVersion: HERDR_ROW_VERSION,
  herdrLostAt: START,
})

const herdrLostLongName = machine(LAPTOP, agentsBeforeHerdrWent, {
  label: LONG_MACHINE_NAME,
  agentVersion: BEHIND_AGENT_VERSION,
  herdrVersion: HERDR_ROW_VERSION,
  herdrLostAt: START,
})

const startedWithHerdrDown = machine(LAPTOP, [], {
  agentVersion: CURRENT_AGENT_VERSION,
  herdrLostAt: START,
})

const startedThenHerdrCame = machine(LAPTOP, agentsBeforeHerdrWent, {
  agentVersion: CURRENT_AGENT_VERSION,
  herdrVersion: HERDR_ROW_VERSION,
  herdrConnection: 2,
})

const herdrLostThenOffline = machine(DESK, [], {
  connection: 'offline',
  agentVersion: CURRENT_AGENT_VERSION,
  herdrVersion: HERDR_ROW_VERSION,
  herdrLostAt: START,
})

const beforeHerdrGoes = machine(LAPTOP, agentsBeforeHerdrWent, {
  agentVersion: BEHIND_AGENT_VERSION,
  herdrVersion: HERDR_ROW_VERSION,
})

const herdrGoneJustNow = machine(LAPTOP, agentsBeforeHerdrWent, {
  agentVersion: BEHIND_AGENT_VERSION,
  herdrVersion: HERDR_ROW_VERSION,
  herdrLostAt: justNow,
})

const herdrBackOnNewConnection = machine(LAPTOP, agentsBeforeHerdrWent, {
  agentVersion: BEHIND_AGENT_VERSION,
  herdrVersion: HERDR_ROW_VERSION,
  herdrConnection: 2,
})

const herdrGoesAndComesBack = [
  step<LinkStage>(800, 'Herdr stops answering the agent', ({ link }) =>
    SubscriptionRef.set(link.state, liveWith(viewOf([herdrGoneJustNow]))),
  ),
  step<LinkStage>(1600, 'Herdr answers again, on a new connection', ({ link }) =>
    Effect.andThen(
      seesText(HERDR_LOST),
      SubscriptionRef.set(link.state, liveWith(viewOf([herdrBackOnNewConnection]))),
    ),
  ),
]

const herdrCameAfterStart = [
  step<LinkStage>(1600, 'Herdr answers for the first time, with agents', ({ link }) =>
    Effect.andThen(
      seesText(HERDR_LOST),
      SubscriptionRef.set(link.state, liveWith(viewOf([startedThenHerdrCame]))),
    ),
  ),
]

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
    slug: 'herdr-lost',
    title: 'Machines, herdr lost on an online machine',
    path: MACHINES_PATH,
    link: liveWith(viewOf([herdrLost])),
    shows: {
      all: [{ text: HERDR_LOST }, { text: `herdr ${HERDR_ROW_VERSION}` }, { absent: UPDATE_AGENT }],
    },
  }),
  linkStory({
    slug: 'herdr-lost-update',
    title: 'Machines, herdr lost beside the update pill, under a short name and a long one',
    path: MACHINES_PATH,
    link: liveWith(viewOf([herdrLostBehindHub, herdrLostLongName])),
    shows: {
      all: [
        { text: HERDR_LOST },
        { text: UPDATE_AGENT },
        { text: LAPTOP },
        { text: LONG_MACHINE_NAME },
      ],
    },
  }),
  linkStory({
    slug: 'herdr-lost-offline',
    title: 'Machines, offline with herdr lost in its last state, so no pill',
    path: MACHINES_PATH,
    link: liveWith(viewOf([herdrLostThenOffline])),
    shows: { all: [{ text: OFFLINE_HINT }, { absent: HERDR_LOST }] },
  }),
  linkStory({
    slug: 'herdr-lost-and-back',
    title: 'Machines, herdr goes and comes back, with the update pill beside it',
    path: MACHINES_PATH,
    link: liveWith(viewOf([beforeHerdrGoes])),
    shows: { all: [{ text: UPDATE_AGENT }, { absent: HERDR_LOST }] },
    ends: { all: [{ text: UPDATE_AGENT }, { absent: HERDR_LOST }] },
    timeline: herdrGoesAndComesBack,
  }),
  linkStory({
    slug: 'herdr-lost-since-start',
    title: 'Machines, its agent started with herdr already down',
    path: MACHINES_PATH,
    link: liveWith(viewOf([startedWithHerdrDown])),
    shows: { all: [{ text: HERDR_LOST }, { text: AGENTS_UNSEEN }, { absent: 'No agents' }] },
  }),
  linkStory({
    slug: 'herdr-lost-since-start-then-back',
    title: 'Machines, an agent started with herdr down, then herdr shows its agents',
    path: MACHINES_PATH,
    link: liveWith(viewOf([startedWithHerdrDown])),
    shows: { text: HERDR_LOST },
    ends: { all: [{ text: '2 agents' }, { absent: HERDR_LOST }] },
    timeline: herdrCameAfterStart,
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
    slug: 'herdr-lost',
    title: 'Machine, herdr lost with its agents kept, in the pill and the row',
    path: MACHINE_PATH,
    link: liveWith(viewOf([herdrLost])),
    shows: { all: [{ text: HERDR_LOST }, { text: LOST_FOR }, { text: 'Agents · 2' }] },
  }),
  linkStory({
    slug: 'herdr-lost-update-long-name',
    title: 'Machine, herdr lost beside the update pill, under a long name',
    path: MACHINE_PATH,
    link: liveWith(viewOf([herdrLostLongName])),
    shows: {
      all: [
        { text: HERDR_LOST },
        { text: UPDATE_AGENT },
        { text: LOST_FOR },
        { text: LONG_MACHINE_NAME },
      ],
    },
  }),
  linkStory({
    slug: 'herdr-lost-since-start',
    title: 'Machine, its agent started with herdr already down',
    path: MACHINE_PATH,
    link: liveWith(viewOf([startedWithHerdrDown])),
    shows: {
      all: [
        { text: HERDR_LOST },
        { text: LOST_FOR },
        { text: MACHINE_AGENTS_UNSEEN },
        { absent: 'Agents · 0' },
        { absent: 'No agents running' },
      ],
    },
  }),
  linkStory({
    slug: 'herdr-lost-since-start-then-back',
    title: 'Machine, an agent started with herdr down, then herdr shows its agents',
    path: MACHINE_PATH,
    link: liveWith(viewOf([startedWithHerdrDown])),
    shows: { text: HERDR_LOST },
    ends: { all: [{ text: 'No agents running' }, { text: 'Agents · 0' }, { absent: LOST_FOR }] },
    timeline: [
      step<LinkStage>(1600, 'Herdr answers for the first time, with no agents', ({ link }) =>
        Effect.andThen(
          seesText(LOST_FOR),
          SubscriptionRef.set(
            link.state,
            liveWith(
              viewOf([
                machine(LAPTOP, [], {
                  agentVersion: CURRENT_AGENT_VERSION,
                  herdrVersion: HERDR_ROW_VERSION,
                  herdrConnection: 2,
                }),
              ]),
            ),
          ),
        ),
      ),
    ],
  }),
  linkStory({
    slug: 'herdr-lost-and-back',
    title: 'Machine, herdr goes and comes back, in the pill and the row',
    path: MACHINE_PATH,
    link: liveWith(viewOf([beforeHerdrGoes])),
    shows: { all: [{ text: HERDR_ROW_VERSION }, { absent: LOST_FOR }] },
    ends: { all: [{ text: HERDR_ROW_VERSION }, { absent: LOST_FOR }] },
    timeline: herdrGoesAndComesBack,
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
