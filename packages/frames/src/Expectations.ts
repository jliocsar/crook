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

const A_CHAT_WITH_ROWS = {
  thread: inSequence('thread-rows'),
  dock: inSequence('composer'),
}

const A_REOPENED_CHAT = A_CHAT_WITH_ROWS

export const NO_DECLARED_ORDER: Expectation = story({})

export const TIMELINE_EXPECTATIONS = {
  'transition/cold-chat-open': story(A_CHAT),
  'transition/cached-reopen-catch-up': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer') },
    { watchFrom: 'first-step' },
  ),
  'transition/reopen-over-big-gap': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer') },
    { watchFrom: 'first-step' },
  ),
  'transition/reopen-over-big-gap-long': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer') },
    { watchFrom: 'first-step' },
  ),
  'transition/long-catch-up': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer') },
    { watchFrom: 'first-step' },
  ),
  'transition/long-catch-up-turns': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer') },
    { watchFrom: 'first-step' },
  ),
  'transition/long-catch-up-over-tall-rows': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer') },
    { watchFrom: 'first-step' },
  ),
  'transition/show-earlier-at-hole': story(
    {
      thread: inSequence('thread-rows'),
      dock: inSequence('composer'),
      hole: inSequence('show-earlier', 'show-earlier-pending'),
    },
    { watchFrom: 'first-step' },
  ),
  'transition/latest-from-far-up': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer') },
    { watchFrom: 'first-step' },
  ),
  'transition/show-earlier-at-hole-long': story(
    {
      thread: inSequence('thread-rows'),
      dock: inSequence('composer'),
      hole: inSequence('show-earlier', 'show-earlier-pending'),
    },
    { watchFrom: 'first-step' },
  ),
  'transition/show-earlier-at-hole-following': story(
    {
      thread: inSequence('thread-rows'),
      dock: inSequence('composer'),
      hole: inSequence('show-earlier', 'show-earlier-pending'),
    },
    { watchFrom: 'first-step' },
  ),
  'transition/slow-catch-up': story(A_REOPENED_CHAT, { watchFrom: 'first-step' }),
  'transition/catch-up-lands-under-words': story(A_REOPENED_CHAT, { watchFrom: 'first-step' }),
  'transition/opened-empty': story({
    thread: inSequence('thread-skeleton', 'thread-empty'),
    dock: inSequence('composer'),
  }),
  'transition/failed-then-retry': story(A_CHAT_WITH_ROWS),
  'transition/show-earlier-loads': story(A_CHAT_WITH_ROWS),
  'transition/resume-after-show-earlier': story(
    {
      thread: fromTable({
        'thread-rows': ['thread-skeleton'],
        'thread-skeleton': ['thread-rows'],
      }),
      dock: inSequence('composer'),
    },
    { watchFrom: 'first-step' },
  ),
  'transition/older-agent-open': story(A_CHAT),
  'transition/older-agent-rejected-resume': story(A_CHAT_WITH_ROWS),
  'transition/reopen-while-dialing': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer') },
    { watchFrom: 'first-step' },
  ),
  'transition/reconnect-chat-open': story(A_CHAT),
  'transition/foreground-return': story({ ...A_CHAT, link: NOTHING_ALLOWED }),
  'transition/send-through-redial': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer'), link: NOTHING_ALLOWED },
    { watchFrom: 'first-step' },
  ),
  'transition/machine-redial': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/machine-gone': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer', 'edge-card'),
  }),
  'transition/machine-back-after-hub-restart': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/send-through-machine-redial': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer') },
    { watchFrom: 'first-step' },
  ),
  'transition/clear': story({ thread: inSequence('thread-rows'), dock: inSequence('composer') }),
  'transition/resume-other-session': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/prompt-to-answer': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'subagent/turn-with-tools': story({
    thread: inSequence('thread-rows'),
  }),
  'transition/turn-with-tools': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/idle-before-answer': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/compact-ends-the-turn': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/slash-send-lands': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/slash-send-following': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/slash-send-following-one-write': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/slash-send-opens-a-dialog': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/slash-send-waiting-blip': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/slash-send-silent': story({
    thread: inSequence('thread-rows'),
    dock: inSequence('composer'),
  }),
  'transition/herd-first-load-from-cache': story({ herd: inSequence('herd-list') }),
  'transition/herd-first-load-fast': story({
    herd: inSequence('herd-list'),
    link: NOTHING_ALLOWED,
  }),
  'transition/herd-first-load-empty': story({ herd: inSequence('herd-skeleton', 'herd-list') }),
  'transition/herd-first-link-value': story({
    herd: inSequence('herd-skeleton', 'herd-list'),
  }),
  'actions/close-card-goes': story({ herd: inSequence('herd-list') }),
  'actions/toast-after-chat-close': story({
    thread: inSequence('thread-rows'),
    herd: inSequence('herd-list'),
  }),
  'machine/forgotten-while-open': story({ cards: inSequence('agent-card', 'empty-state') }),
  'machine/forget-stays-pending': story({}),
  'machine/herdr-lost-and-back': story({
    cards: inSequence('agent-card'),
    herdr: inSequence('herdr-lost'),
  }),
  'machines/herdr-lost-and-back': story({
    cards: inSequence('machine-card'),
    herdr: inSequence('herdr-lost'),
  }),
  'herd/herdr-lost-and-back': story({
    cards: inSequence('agent-card'),
    herdr: inSequence('herdr-lost'),
  }),
  'herd/herdr-lost-nothing-then-back': story({
    cards: inSequence('agent-card'),
    herdr: inSequence('herdr-lost'),
  }),
  'machine/herdr-lost-since-start-then-back': story({
    cards: inSequence('agent-card'),
    herdr: inSequence('herdr-lost'),
  }),
  'machines/herdr-lost-since-start-then-back': story({
    cards: inSequence('machine-card'),
    herdr: inSequence('herdr-lost'),
  }),
  'composer/send-answered-past-the-delay': story(A_CHAT_WITH_ROWS),
  'composer/send-failed-then-edited': story(A_CHAT_WITH_ROWS),
  'composer/claude-waiting-ends': story(A_CHAT_WITH_ROWS),
  'composer/stop-failed-then-turn-ends': story(A_CHAT_WITH_ROWS),
  'chat/restart-gives-up': story(
    { thread: inSequence('thread-rows'), dock: inSequence('composer', 'edge-card') },
    { watchFrom: 'first-step' },
  ),
  'actions/rename-gives-up': story({}),
  'actions/close-gives-up': story({}),
  'new-agent/shows-after-giving-up': story({
    'new-agent': inSequence('task-composer'),
    thread: inSequence('thread-skeleton', 'thread-rows'),
    dock: inSequence('composer'),
  }),
  'settings/test-sent-clears': story({}),
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
