import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { PaneClosed, PaneRenamed } from '@crook/domain/Command'
import type { AgentRow } from '@crook/domain/AgentRow'
import { CommandTimedOut, PaneNotCreatedByCrook } from '@crook/protocol/Commands'
import { HubStorageFailed } from '@crook/protocol/ClientApi'
import { UNREACHABLE } from '@crook/web/rpc/HubLinkState'
import { UNCONFIRMED_NOTE } from '@crook/web/atoms/ActionProgress'
import { ActionsIntent, agentActionsAtom, PaneAddress } from '@crook/web/atoms/AgentActions'

import { liveWith, stateWith } from '../../test/AppWiring.tsx'
import { agent, herd, LAPTOP, machine } from '../../test/HerdFixtures.ts'
import { AGENTS_PATH } from '../Fixtures.ts'
import { clicks, element, pressesInstantly, sees, seesText, types } from '../StageDom.ts'
import { linkStory, step } from '../Story.tsx'
import type { LinkStage, LinkStorySpec, StoryMaker } from '../Story.tsx'

const COMMAND_TIMEOUT_SECONDS = 10
const STORY_SENT_BOUND = Duration.seconds(1.5)
const RENAME_FIELD = 'Agent name'
const HOLD_TO_CLOSE = 'Hold to close agent'

const porting = agent('w1:p1', 'working', {
  title: 'Port the herd screen',
  secondsAgo: 42,
  createdByCrook: true,
})
const wiring = agent('w1:p2', 'blocked', { title: 'Wire the hub link', secondsAgo: 180 })
const banner = agent('w1:p3', 'idle', { title: 'Write the banner', createdByCrook: true })

const laptopWith = (agents: readonly AgentRow[]) => machine(LAPTOP, agents)

const EVERYONE = liveWith(herd([laptopWith([porting, wiring, banner])]))
const REST = liveWith(herd([laptopWith([wiring, banner])]))
const PORTING_CHAT = '/m/laptop/p/w1%3Ap1'

const openSheet = ({ registry }: LinkStage, pane: AgentRow['pane'] = porting.pane) =>
  Effect.gen(function* () {
    yield* seesText('Port the herd screen')
    yield* Effect.sync(() => {
      registry.set(
        agentActionsAtom,
        ActionsIntent.Open({
          agent: new PaneAddress({ machine: LAPTOP, pane }),
          origin: 'card',
        }),
      )
    })
    yield* element('[role="dialog"]')
  })

const closedPane = Exit.succeed(new PaneClosed({ pane: porting.pane }))

const renamed = Exit.succeed(new PaneRenamed({ pane: porting.pane, label: Option.some('Herd') }))

const timedOut = Exit.fail(
  new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(COMMAND_TIMEOUT_SECONDS) }),
)

const story = (spec: Omit<LinkStorySpec, 'path' | 'link'>) =>
  linkStory({ ...spec, path: AGENTS_PATH, link: EVERYONE })

const renameTo = (name: string) =>
  Effect.gen(function* () {
    yield* clicks('Rename')
    yield* types(RENAME_FIELD, name)
  })

export const ACTIONS_STORIES: readonly StoryMaker[] = [
  story({
    slug: 'idle',
    title: 'Actions sheet, closed pane crook made',
    settle: openSheet,
    shows: { text: HOLD_TO_CLOSE },
  }),
  story({
    slug: 'not-created-by-crook',
    title: 'Actions sheet, a pane crook did not make',
    settle: (stage) => openSheet(stage, wiring.pane),
    shows: { text: "crook didn't open this pane" },
  }),
  linkStory({
    slug: 'cannot-act',
    title: 'Actions sheet, while the hub cannot act',
    shows: { selector: '[data-slot="sheet"] button[disabled]' },
    path: AGENTS_PATH,
    link: stateWith(UNREACHABLE, Option.some(herd([laptopWith([porting, wiring, banner])]))),
    settle: openSheet,
  }),
  story({
    slug: 'rename-editing',
    title: 'Actions sheet, renaming',
    shows: { selector: 'input[aria-label="Agent name"]' },
    settle: (stage) => Effect.andThen(openSheet(stage), clicks('Rename')),
  }),
  story({
    slug: 'rename-invalid',
    title: 'Actions sheet, a name it refuses',
    settle: (stage) =>
      Effect.andThen(openSheet(stage), Effect.andThen(renameTo('\u0007bell'), clicks('Save'))),
    shows: { selector: '[role="alert"]' },
  }),
  story({
    slug: 'rename-saving',
    title: 'Actions sheet, Saving',
    arrange: ({ link }) =>
      Effect.andThen(Ref.set(link.commandAnswer, renamed), link.commandAnswers.close),
    settle: (stage) =>
      Effect.andThen(openSheet(stage), Effect.andThen(renameTo('Herd'), clicks('Save'))),
    shows: { text: 'Saving…' },
  }),
  story({
    slug: 'rename-failed',
    title: 'Actions sheet, a rename that timed out',
    arrange: ({ link }) => Ref.set(link.commandAnswer, timedOut),
    settle: (stage) =>
      Effect.andThen(openSheet(stage), Effect.andThen(renameTo('Herd'), clicks('Save'))),
    shows: { selector: '[role="alert"]' },
  }),
  story({
    slug: 'closing',
    title: 'Actions sheet, Closing',
    arrange: ({ link }) =>
      Effect.andThen(Ref.set(link.commandAnswer, closedPane), link.commandAnswers.close),
    settle: (stage) => Effect.andThen(openSheet(stage), pressesInstantly(HOLD_TO_CLOSE)),
    shows: { text: 'Closing' },
  }),
  story({
    slug: 'rename-gives-up',
    title: 'Actions sheet, a rename the herd never shows, Saving giving way at its bound',
    shows: { text: 'Saving…' },
    ends: { text: UNCONFIRMED_NOTE },
    sentBound: STORY_SENT_BOUND,
    arrange: ({ link }) => Ref.set(link.commandAnswer, renamed),
    settle: (stage) =>
      Effect.andThen(openSheet(stage), Effect.andThen(renameTo('Herd'), clicks('Save'))),
    timeline: [step<LinkStage>(1800, 'The bound runs out', () => seesText('Save'))],
  }),
  story({
    slug: 'close-gives-up',
    title: 'Actions sheet, a close the herd never shows, Closing giving way at its bound',
    shows: { text: 'Closing' },
    ends: { all: [{ text: UNCONFIRMED_NOTE }, { text: HOLD_TO_CLOSE }] },
    sentBound: STORY_SENT_BOUND,
    arrange: ({ link }) => Ref.set(link.commandAnswer, closedPane),
    settle: (stage) => Effect.andThen(openSheet(stage), pressesInstantly(HOLD_TO_CLOSE)),
    timeline: [step<LinkStage>(1800, 'The bound runs out', () => seesText(HOLD_TO_CLOSE))],
  }),
  story({
    slug: 'close-confirm',
    title: 'Actions sheet, asks to confirm a close',
    arrange: ({ link }) =>
      Ref.set(link.commandAnswer, Exit.fail(new PaneNotCreatedByCrook({ pane: porting.pane }))),
    settle: (stage) => Effect.andThen(openSheet(stage), pressesInstantly(HOLD_TO_CLOSE)),
    shows: { text: 'Hold to close anyway' },
  }),
  story({
    slug: 'close-failed',
    title: 'Actions sheet, a close that timed out',
    arrange: ({ link }) => Ref.set(link.commandAnswer, timedOut),
    settle: (stage) => Effect.andThen(openSheet(stage), pressesInstantly(HOLD_TO_CLOSE)),
    shows: { selector: '[role="alert"]' },
  }),
  story({
    slug: 'pin-failed',
    title: 'Actions sheet, the hub refused a pin',
    arrange: ({ link }) =>
      Ref.set(link.pinRefusal, Option.some(new HubStorageFailed({ detail: 'disk full' }))),
    settle: (stage) => Effect.andThen(openSheet(stage), clicks('Pin to top')),
    shows: { text: 'could not save that' },
  }),
  story({
    slug: 'close-card-goes',
    title: 'Actions sheet, a close that lands',
    shows: { selector: '[data-slot="sheet"]' },
    ends: { absent: 'Port the herd screen' },
    arrange: ({ link }) => Ref.set(link.commandAnswer, closedPane),
    settle: openSheet,
    timeline: [
      step<LinkStage>(400, 'Hold to close', () => pressesInstantly(HOLD_TO_CLOSE)),
      step<LinkStage>(600, 'The herd drops the pane', ({ link }) =>
        SubscriptionRef.set(link.state, REST),
      ),
    ],
  }),
  linkStory({
    slug: 'toast-after-chat-close',
    title: 'Toast, a close from the chat lands on the herd',
    shows: { selector: '[data-slot="sheet"]' },
    ends: { all: [{ text: 'Pane closed' }, { selector: '[data-slot="herd-list"]' }] },
    path: PORTING_CHAT,
    link: EVERYONE,
    arrange: ({ link }) => Ref.set(link.commandAnswer, closedPane),
    settle: ({ registry }) =>
      Effect.gen(function* () {
        yield* seesText('Port the herd screen')
        yield* Effect.sync(() => {
          registry.set(
            agentActionsAtom,
            ActionsIntent.Open({
              agent: new PaneAddress({ machine: LAPTOP, pane: porting.pane }),
              origin: 'chat',
            }),
          )
        })
        yield* element('[role="dialog"]')
      }),
    timeline: [
      step<LinkStage>(400, 'Hold to close', () => pressesInstantly(HOLD_TO_CLOSE)),
      step<LinkStage>(
        600,
        'The herd drops the pane, the chat goes back, the toast shows',
        ({ link }) =>
          Effect.andThen(SubscriptionRef.set(link.state, REST), sees({ text: 'Pane closed' })),
      ),
    ],
  }),
]
