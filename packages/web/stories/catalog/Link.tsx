import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

import { COLD_START, LinkStatus, QUIET_DIALING } from '@crook/web/rpc/HubLinkState'

import { stateWith } from '../../test/AppWiring.tsx'
import {
  AGENTS_PATH,
  CHAT_PATH,
  CONVERSATION,
  feed,
  MACHINE_PATH,
  MACHINES_PATH,
  NEW_AGENT_PATH,
  REVIEW_LAUNCH,
  REVIEW_LINES,
  SETTINGS_PATH,
  SUBAGENT_PATH,
  SUBAGENT_SOURCE,
  TEAM,
} from '../Fixtures.ts'
import { BEFORE_FIRST_VALUE, linkStory } from '../Story.tsx'
import type { LinkStage, LinkStorySpec, StoryMaker, Witness } from '../Story.tsx'

export interface LinkScreen {
  readonly slug: string
  readonly title: string
  readonly path: string
  readonly arrange: (stage: LinkStage) => Effect.Effect<void>
}

export interface LinkMoment {
  readonly slug: string
  readonly title: string
  readonly seed: LinkStorySpec['link']
  readonly shows: Witness
}

export const ANNOUNCED_DIALING = LinkStatus.Dialing({
  announced: true,
  afterFailure: false,
  coldStart: false,
})

const WITH_TEAM = Option.some(TEAM)
const NO_HERD = Option.none()
const LOGGED_OUT_WITNESS: Witness = { text: 'Log in' }
const SHELL_WITNESS: Witness = { selector: 'nav[aria-label="Sections"]' }

export const LINK_SCREENS: readonly LinkScreen[] = [
  { slug: 'agents', title: 'Agents', path: AGENTS_PATH, arrange: () => Effect.void },
  { slug: 'machines', title: 'Machines', path: MACHINES_PATH, arrange: () => Effect.void },
  { slug: 'machine', title: 'Machine', path: MACHINE_PATH, arrange: () => Effect.void },
  { slug: 'new-agent', title: 'New agent', path: NEW_AGENT_PATH, arrange: () => Effect.void },
  { slug: 'settings', title: 'Settings', path: SETTINGS_PATH, arrange: () => Effect.void },
  {
    slug: 'chat',
    title: 'Chat',
    path: CHAT_PATH,
    arrange: ({ link }) => feed(link, CONVERSATION),
  },
  {
    slug: 'subagent',
    title: 'Subagent',
    path: SUBAGENT_PATH,
    arrange: ({ link }) =>
      Effect.andThen(feed(link, REVIEW_LAUNCH), feed(link, REVIEW_LINES, SUBAGENT_SOURCE)),
  },
]

export const LINK_MOMENTS: readonly LinkMoment[] = [
  {
    slug: 'before-first-value',
    title: 'Before the first value',
    seed: BEFORE_FIRST_VALUE,
    shows: SHELL_WITNESS,
  },
  {
    slug: 'dialing-cold-cached',
    title: 'Dialing, cold start with a cached herd',
    seed: stateWith(COLD_START, WITH_TEAM),
    shows: SHELL_WITNESS,
  },
  {
    slug: 'dialing-cold-empty',
    title: 'Dialing, cold start with nothing cached',
    seed: stateWith(COLD_START, NO_HERD),
    shows: SHELL_WITNESS,
  },
  {
    slug: 'dialing-quiet',
    title: 'Dialing, quiet redial from Live',
    seed: stateWith(QUIET_DIALING, WITH_TEAM),
    shows: SHELL_WITNESS,
  },
  {
    slug: 'dialing-announced-syncing',
    title: 'Dialing, announced with a herd',
    seed: stateWith(ANNOUNCED_DIALING, WITH_TEAM),
    shows: { text: 'Syncing' },
  },
  {
    slug: 'dialing-announced-connecting',
    title: 'Dialing, announced with no herd',
    seed: stateWith(ANNOUNCED_DIALING, NO_HERD),
    shows: { text: 'Connecting to the hub' },
  },
  {
    slug: 'live',
    title: 'Live',
    seed: stateWith(LinkStatus.Live({ recovered: false }), WITH_TEAM),
    shows: SHELL_WITNESS,
  },
  {
    slug: 'live-recovered',
    title: 'Live, just recovered',
    seed: stateWith(LinkStatus.Live({ recovered: true }), WITH_TEAM),
    shows: { text: 'Back online' },
  },
  {
    slug: 'unreachable',
    title: 'Unreachable',
    seed: stateWith(LinkStatus.Unreachable(), WITH_TEAM),
    shows: { text: "Can't reach the hub" },
  },
  {
    slug: 'unreachable-empty',
    title: 'Unreachable with no herd',
    seed: stateWith(LinkStatus.Unreachable(), NO_HERD),
    shows: { text: "Can't reach the hub" },
  },
  {
    slug: 'offline',
    title: 'Offline',
    seed: stateWith(LinkStatus.Offline(), WITH_TEAM),
    shows: { text: "You're offline" },
  },
  {
    slug: 'expired',
    title: 'Expired',
    seed: stateWith(LinkStatus.Expired(), WITH_TEAM),
    shows: LOGGED_OUT_WITNESS,
  },
  {
    slug: 'logged-out',
    title: 'Logged out',
    seed: stateWith(LinkStatus.LoggedOut(), NO_HERD),
    shows: LOGGED_OUT_WITNESS,
  },
]

export const LINK_STORIES: readonly StoryMaker[] = Arr.flatMap(LINK_MOMENTS, (moment) =>
  Arr.map(LINK_SCREENS, (screen) =>
    linkStory({
      slug: `${moment.slug}/${screen.slug}`,
      title: `${moment.title}, ${screen.title}`,
      path: screen.path,
      link: moment.seed,
      shows: moment.shows,
      arrange: screen.arrange,
    }),
  ),
)
