import * as Deferred from 'effect/Deferred'
import * as Option from 'effect/Option'

import { LinkStatus } from '@crook/web/rpc/HubLinkState'

import { liveWith, stateWith } from '../../test/AppWiring.tsx'
import { AGENTS_PATH, TEAM } from '../Fixtures.ts'
import { clicks } from '../StageDom.ts'
import { linkStory } from '../Story.tsx'
import type { StoryMaker } from '../Story.tsx'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1'

const PHONE_TOUCH_POINTS = 5
const LIVE_TEAM = liveWith(TEAM)

const notStandalone = (userAgent: string) => ({
  standalone: false,
  userAgent: Option.some(userAgent),
  maxTouchPoints: Option.some(PHONE_TOUCH_POINTS),
})

export const GATE_STORIES: readonly StoryMaker[] = [
  linkStory({
    slug: 'install-safari',
    title: 'Install, Safari steps',
    path: AGENTS_PATH,
    link: LIVE_TEAM,
    env: notStandalone(IPHONE_SAFARI),
    shows: { text: 'Tap Share in the toolbar' },
  }),
  linkStory({
    slug: 'install-chrome',
    title: 'Install, Chrome steps',
    path: AGENTS_PATH,
    link: LIVE_TEAM,
    env: notStandalone(IPHONE_CHROME),
    shows: { text: 'Add crook to your Home Screen' },
  }),
  linkStory({
    slug: 'install-continued',
    title: 'Install, continued in the browser',
    note: 'A press on the install screen lands in the app, and the choice lasts the tab.',
    path: AGENTS_PATH,
    link: LIVE_TEAM,
    env: notStandalone(IPHONE_SAFARI),
    settle: () => clicks(/continue/iu),
    shows: { text: 'Fix the reconnect banner' },
  }),
  linkStory({
    slug: 'session-expired',
    title: 'Logged out, session expired',
    path: AGENTS_PATH,
    link: stateWith(LinkStatus.Expired(), Option.some(TEAM)),
    shows: { text: 'Your session expired' },
  }),
  linkStory({
    slug: 'logged-out',
    title: 'Logged out, by choice',
    path: AGENTS_PATH,
    link: stateWith(LinkStatus.LoggedOut(), Option.none()),
    shows: { text: "You're logged out" },
  }),
  linkStory({
    slug: 'link-failure',
    title: 'Hub gate, the link died',
    note: 'A defect on the link throws to the route error boundary.',
    path: AGENTS_PATH,
    link: LIVE_TEAM,
    settle: ({ link }) => Deferred.die(link.stateDefect, new Error('The link died.')),
    shows: { text: 'Something broke' },
  }),
  linkStory({
    slug: 'not-found',
    title: 'Unknown route, sent home',
    path: '/no/such/screen',
    link: LIVE_TEAM,
    shows: { text: 'Fix the reconnect banner' },
  }),
]
