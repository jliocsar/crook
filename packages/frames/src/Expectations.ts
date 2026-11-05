import type { MarkPair } from '@crook/frames/Marks'

export interface Order {
  readonly next: ReadonlyMap<string, readonly string[]>
}

export type WatchFrom = 'mount' | 'first-step'

export interface Expectation {
  readonly watchFrom: WatchFrom
  readonly order: Readonly<Record<string, Order>>
  readonly forbiddenPairs: readonly MarkPair[]
  readonly shiftBudget: number
}

export const inSequence = (...states: readonly string[]): Order => ({
  next: new Map(states.map((state, index) => [state, states.slice(index + 1)])),
})

export const fromTable = (table: Readonly<Record<string, readonly string[]>>): Order => ({
  next: new Map(Object.entries(table)),
})

export const NOTHING_ALLOWED = inSequence()
export const STILL_SHIFT_BUDGET = 0.01
export const BANNER_SHIFT_BUDGET = 0.06

const story = (
  order: Readonly<Record<string, Order>>,
  options: Partial<Omit<Expectation, 'order'>> = {},
): Expectation => ({
  watchFrom: 'mount',
  forbiddenPairs: [],
  shiftBudget: STILL_SHIFT_BUDGET,
  order,
  ...options,
})

const A_CHAT = {
  thread: inSequence('thread-skeleton', 'thread-rows'),
  dock: inSequence('composer'),
}

export const NO_DECLARED_ORDER: Expectation = story({})

export const TIMELINE_EXPECTATIONS = {
  'transition/cold-chat-open': story(A_CHAT),
  'transition/cached-reopen-catch-up': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer') },
    { watchFrom: 'first-step' },
  ),
  'transition/reconnect-chat-open': story(A_CHAT, { shiftBudget: BANNER_SHIFT_BUDGET }),
  'transition/foreground-return': story({ ...A_CHAT, link: NOTHING_ALLOWED }),
  'transition/send-through-redial': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer'), link: NOTHING_ALLOWED },
    { watchFrom: 'first-step' },
  ),
  'transition/machine-redial': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/clear': story({ thread: inSequence('thread-rows'), dock: inSequence('composer') }),
  'transition/resume-other-session': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/prompt-to-answer': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/herd-first-load-from-cache': story(
    { herd: inSequence('herd-list') },
    { shiftBudget: BANNER_SHIFT_BUDGET },
  ),
  'transition/herd-first-load-fast': story({
    herd: inSequence('herd-list'),
    link: NOTHING_ALLOWED,
  }),
  'transition/herd-first-load-empty': story(
    { herd: inSequence('herd-skeleton', 'herd-list') },
    { shiftBudget: BANNER_SHIFT_BUDGET },
  ),
  'transition/herd-first-link-value': story({
    herd: inSequence('herd-skeleton', 'herd-list'),
  }),
  'actions/close-card-goes': story({ herd: inSequence('herd-list') }),
  'actions/toast-after-chat-close': story({
    thread: inSequence('thread-rows'),
    herd: inSequence('herd-list'),
  }),
  'machine/forgotten-while-open': story({ cards: inSequence('agent-card', 'empty-state') }),
  'new-agent/start-to-chat': story({
    'new-agent': inSequence('task-composer'),
    thread: inSequence('thread-skeleton', 'thread-rows'),
    dock: inSequence('composer'),
  }),
  'background/dock-to-summary': story({
    thread: inSequence('thread-rows'),
    background: inSequence('background-dock', 'background-summary'),
  }),
  'ask/next-ask': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
    ask: inSequence('ask-dock'),
  }),
} satisfies Record<string, Expectation>

export const TIMELINE_STORY_IDS: readonly string[] = Object.keys(TIMELINE_EXPECTATIONS)

export const expectationOf = (id: string): Expectation =>
  new Map<string, Expectation>(Object.entries(TIMELINE_EXPECTATIONS)).get(id) ?? NO_DECLARED_ORDER
