export interface MachineStates {
  readonly name: string
  readonly states: readonly string[]
}

export interface MarkDefinition {
  readonly mark: string
  readonly track: string
  readonly selector: string
  readonly machine?: MachineStates
  readonly text?: string
  readonly content?: boolean
}

export type MarkPair = readonly [string, string]

export const MACHINE_ATTRIBUTE = 'data-machine'
export const STATE_ATTRIBUTE = 'data-state'
export const MACHINE_SELECTOR = `[${MACHINE_ATTRIBUTE}]`
export const ROW_SELECTOR = '[data-row]'
export const STAGE_SELECTOR = '#root'
export const COVER_SELECTOR = '[data-slot="pushed-screen"]'
export const SCREEN_SELECTOR = `${COVER_SELECTOR}, [data-slot="tab-scroller"]`

export const CHROME_SELECTOR =
  'header, nav, [data-slot="chat-dock"], [data-slot="new-agent-dock"], [data-slot="toast"], [data-slot="sheet"], [data-slot="sheet-backdrop"]'

export const machineSelector = (name: string, states: readonly string[]): string =>
  states
    .map((state) => `[${MACHINE_ATTRIBUTE}="${name}"][${STATE_ATTRIBUTE}="${state}"]`)
    .join(', ')

export const MARKS: readonly MarkDefinition[] = [
  {
    mark: 'thread-skeleton',
    track: 'thread',
    selector: '[data-slot="thread-skeleton"]',
    content: true,
  },
  {
    mark: 'thread-empty',
    track: 'thread',
    selector: '[data-slot="empty-state"]',
    text: 'No messages yet',
    content: true,
  },
  { mark: 'thread-rows', track: 'thread', selector: ROW_SELECTOR, content: true },
  { mark: 'herd-skeleton', track: 'herd', selector: '[data-slot="herd-skeleton"]', content: true },
  { mark: 'herd-list', track: 'herd', selector: '[data-slot="herd-list"]', content: true },
  { mark: 'agent-card', track: 'cards', selector: '[data-slot="agent-card"]', content: true },
  { mark: 'machine-card', track: 'cards', selector: '[data-slot="machine-card"]', content: true },
  { mark: 'empty-state', track: 'cards', selector: '[data-slot="empty-state"]', content: true },
  { mark: 'task-composer', track: 'new-agent', selector: '[data-slot="task-composer"]' },
  { mark: 'dimmed', track: 'dimmed', selector: `[${STATE_ATTRIBUTE}="dimmed"]` },
  { mark: 'catching-up', track: 'header', selector: '[data-slot="catching-up-pill"]' },
  { mark: 'working', track: 'activity', selector: '[data-slot="thinking-state"]' },
  { mark: 'composer', track: 'dock', selector: '[data-slot="composer"]' },
  { mark: 'edge-card', track: 'dock', selector: '[data-slot="edge-card"]' },
  {
    mark: 'composer-paused',
    track: 'paused',
    selector: '[data-slot="prompt-input-field"]:disabled',
  },
  { mark: 'ask-dock', track: 'ask', selector: '[data-slot="ask-dock"]' },
  { mark: 'banner', track: 'link', selector: '[data-slot="connection-banner"]' },
  { mark: 'spinner', track: 'indicator', selector: '[data-slot="spinner"]' },
  { mark: 'toast', track: 'toast', selector: '[data-slot="toast"]' },
  { mark: 'sheet', track: 'sheet', selector: '[data-slot="sheet"]' },
  { mark: 'alert', track: 'alert', selector: '[role="alert"]' },
  { mark: 'catch-up-divider', track: 'catch-up', selector: '[data-slot="catch-up-divider"]' },
  { mark: 'background-dock', track: 'background', selector: '[data-slot="background-dock"]' },
  {
    mark: 'background-summary',
    track: 'background',
    selector: '[data-slot="background-summary"]',
  },
]

export const NEVER_TOGETHER: readonly MarkPair[] = [
  ['thread-skeleton', 'thread-rows'],
  ['thread-skeleton', 'thread-empty'],
  ['thread-empty', 'thread-rows'],
  ['herd-skeleton', 'herd-list'],
  ['composer', 'edge-card'],
]

export const isContentMark = (mark: string): boolean =>
  MARKS.some((definition) => definition.mark === mark && definition.content === true)
