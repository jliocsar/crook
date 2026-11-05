import * as Arr from 'effect/Array'

import { ACTIONS_STORIES } from './catalog/Actions.tsx'
import { ASK_STORIES } from './catalog/Ask.tsx'
import { BACKGROUND_STORIES } from './catalog/Background.tsx'
import { CHAT_STORIES } from './catalog/Chat.tsx'
import { COMPOSER_STORIES } from './catalog/Composer.tsx'
import { ENVIRONMENT_STORIES } from './catalog/Environment.tsx'
import { REAL_TRANSCRIPT_STORIES } from './catalog/RealTranscripts.tsx'
import { ROW_STORIES } from './catalog/Rows.tsx'
import { SUBAGENT_STORIES } from './catalog/Subagent.tsx'
import { TRANSITION_STORIES } from './catalog/Transitions.tsx'
import { GATE_STORIES } from './catalog/Gate.tsx'
import { HERD_STORIES } from './catalog/Herd.tsx'
import { LINK_STORIES } from './catalog/Link.tsx'
import { MACHINE_STORIES, MACHINES_STORIES } from './catalog/Machines.tsx'
import { NEW_AGENT_STORIES } from './catalog/NewAgent.tsx'
import { SETTINGS_STORIES } from './catalog/Settings.tsx'
import { KITCHEN_STORIES } from './Kitchen.tsx'
import type { Story, StoryMaker } from './Story.tsx'

const groupOf = (group: string, makers: readonly StoryMaker[]): readonly Story[] =>
  Arr.map(makers, (make) => make(group))

export const CATALOG_STORIES: readonly Story[] = [
  ...groupOf('gate', GATE_STORIES),
  ...groupOf('herd', HERD_STORIES),
  ...groupOf('machines', MACHINES_STORIES),
  ...groupOf('machine', MACHINE_STORIES),
  ...groupOf('new-agent', NEW_AGENT_STORIES),
  ...groupOf('settings', SETTINGS_STORIES),
  ...groupOf('actions', ACTIONS_STORIES),
  ...groupOf('chat', CHAT_STORIES),
  ...groupOf('rows', ROW_STORIES),
  ...groupOf('composer', COMPOSER_STORIES),
  ...groupOf('ask', ASK_STORIES),
  ...groupOf('background', BACKGROUND_STORIES),
  ...groupOf('subagent', SUBAGENT_STORIES),
  ...groupOf('real', REAL_TRANSCRIPT_STORIES),
  ...groupOf('environment', ENVIRONMENT_STORIES),
  ...groupOf('transition', TRANSITION_STORIES),
  ...groupOf('link', LINK_STORIES),
]

export const STORIES: readonly Story[] = [...CATALOG_STORIES, ...KITCHEN_STORIES]
