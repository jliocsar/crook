import { liveWith } from '../../test/AppWiring.tsx'
import { herd } from '../../test/HerdFixtures.ts'
import { chatStory } from '../ChatFixtures.ts'
import {
  AGENTS_PATH,
  CONVERSATION,
  MACHINES_PATH,
  NEW_AGENT_PATH,
  SETTINGS_PATH,
  TEAM,
} from '../Fixtures.ts'
import { clicks, types } from '../StageDom.ts'
import { linkStory } from '../Story.tsx'
import type { StoryMaker } from '../Story.tsx'

const KEYBOARD_UP = { keyboardUp: true }
const REDUCED = { reducedMotion: true }
const LIVE_TEAM = liveWith(TEAM)

export const ENVIRONMENT_STORIES: readonly StoryMaker[] = [
  chatStory({
    slug: 'keyboard-chat',
    title: 'Keyboard up, chat',
    env: KEYBOARD_UP,
    events: CONVERSATION,
    settle: () => types(/Message|Reply/u, 'Now check the toast'),
    shows: { selector: '[data-keyboard="open"]' },
  }),
  chatStory({
    slug: 'keyboard-slash',
    title: 'Keyboard up, slash list',
    env: KEYBOARD_UP,
    events: CONVERSATION,
    settle: () => types(/Message|Reply/u, '/'),
    shows: { text: 'Claude Code' },
  }),
  linkStory({
    slug: 'keyboard-new-agent',
    title: 'Keyboard up, New agent',
    shows: {
      selector: '[data-keyboard="open"] textarea[placeholder="What should Claude work on?"]',
    },
    env: KEYBOARD_UP,
    path: NEW_AGENT_PATH,
    link: LIVE_TEAM,
    settle: () => types('First message to Claude', 'Fix the banner'),
  }),
  linkStory({
    slug: 'reduced-herd',
    title: 'Reduced motion, Agents',
    env: REDUCED,
    path: AGENTS_PATH,
    link: LIVE_TEAM,
    shows: { text: 'Run the nightly build' },
  }),
  linkStory({
    slug: 'reduced-machines',
    title: 'Reduced motion, Machines',
    shows: { selector: '[data-slot="machine-card"]' },
    env: REDUCED,
    path: MACHINES_PATH,
    link: LIVE_TEAM,
  }),
  linkStory({
    slug: 'reduced-settings',
    title: 'Reduced motion, Settings',
    shows: { text: 'Live Activity' },
    env: REDUCED,
    path: SETTINGS_PATH,
    link: liveWith(herd([])),
  }),
  chatStory({
    slug: 'reduced-chat',
    title: 'Reduced motion, chat',
    env: REDUCED,
    events: CONVERSATION,
    shows: { text: 'The quiet redial' },
  }),
  chatStory({
    slug: 'reduced-sheet',
    title: 'Reduced motion, a sheet',
    env: REDUCED,
    events: CONVERSATION,
    settle: () => clicks(/^Actions for/u),
    shows: { selector: '[role="dialog"]' },
  }),
]
