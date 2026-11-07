import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach } from 'vitest'

import { Prompt } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubLinkState } from '@crook/web/rpc/HubLinkState'

import { liveWith, renderApp } from '../AppRender.tsx'
import { eventually, wait } from '../Dom.ts'
import { messagesOf } from '../../stories/RealTranscriptFixtures.ts'
import { agent, DESK, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { inputDelivered } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { RENDER_COUNTS } from '../RenderCounter.ts'
import { phoneViewport } from '../ThreadRender.tsx'
import { chunk, opened, prompt } from '../TranscriptFixtures.ts'

const WATCHED = ['HubGate', 'Shell', 'ToastHost', 'AgentActions']
const WATCHED_IN_CHAT = ['ChatBody', 'ChatDock']
const WATCHED_OF_A_CARD = ['AgentCard', 'AgentStatusPill', 'AgentMeta']
const WATCHED_OF_A_CLOCK_SECOND = ['HerdList', 'AgentCard', 'AgentStatusPill', 'Swap']
const WATCHED_OF_THE_MACHINE_LIST = ['MachineList', 'MachineCardBody', 'MachineBadge']
const HERD_UPDATES = 10
const SETTLE_MS = 30
const LONGER_THAN_A_TICK_MS = 1100
const CARDS_ON_A_MACHINE = 5
const CHAT = '/m/laptop/p/w1:p1'
const MACHINES = '/machines'
const LAPTOP_DETAIL = '/machines/laptop'

const laptop = machine(LAPTOP, [agent('w1:p1', 'idle', { title: 'Stays as it is' })])
const deskAt = (secondsAgo: number) =>
  machine(DESK, [agent('w2:p1', 'working', { title: 'On the other machine', secondsAgo })])
const cardsOf = (id: typeof LAPTOP, prefix: string, moved: number) =>
  machine(
    id,
    Arr.makeBy(CARDS_ON_A_MACHINE, (index) =>
      agent(`${prefix}:p${index + 1}`, 'working', {
        title: `Agent ${prefix} ${index + 1}`,
        secondsAgo: index === 0 ? moved : 60,
      }),
    ),
  )
const countedOf = (names: readonly string[]) =>
  Arr.map(names, (name) => RENDER_COUNTS.get(name) ?? 0)
const counted = () => countedOf(WATCHED)
const setsHerd = (
  link: { readonly state: SubscriptionRef.SubscriptionRef<HubLinkState> },
  machines: Parameters<typeof herd>[0],
  update: number,
) =>
  SubscriptionRef.update(
    link.state,
    (current) =>
      new HubLinkState({
        status: current.status,
        herd: Option.some(
          new HerdSnapshot({
            view: herd(machines),
            syncedAt: DateTime.add(START, { seconds: update }),
          }),
        ),
      }),
  )
const subtract = (after: readonly number[], before: readonly number[]) =>
  Arr.zipWith(after, before, (later, earlier) => later - earlier)

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
})

describe('a shown Agents page', () => {
  it.effect('renders only the card a herd update changed', () =>
    Effect.gen(function* () {
      const steadyLaptop = cardsOf(LAPTOP, 'w1', 0)
      const { link } = yield* renderApp('/', liveWith(herd([steadyLaptop, cardsOf(DESK, 'w2', 0)])))

      yield* Effect.promise(() => screen.findByText('Agent w2 1'))
      yield* wait(SETTLE_MS)

      const before = countedOf(WATCHED_OF_A_CARD)
      const presencesBefore = RENDER_COUNTS.get('AnimatePresence') ?? 0

      yield* Effect.forEach(
        Arr.range(1, HERD_UPDATES),
        (update) =>
          setsHerd(link, [steadyLaptop, cardsOf(DESK, 'w2', update)], update).pipe(
            Effect.andThen(wait(SETTLE_MS)),
          ),
        { discard: true },
      )

      expect(subtract(countedOf(WATCHED_OF_A_CARD), before)).toEqual([
        HERD_UPDATES,
        HERD_UPDATES,
        HERD_UPDATES,
      ])
      expect((RENDER_COUNTS.get('AnimatePresence') ?? 0) - presencesBefore).toBeLessThan(
        HERD_UPDATES * CARDS_ON_A_MACHINE * 2,
      )
    }),
  )

  it.effect('renders only the elapsed labels on a clock second', () =>
    Effect.gen(function* () {
      yield* renderApp('/', liveWith(herd([cardsOf(LAPTOP, 'w1', 0)])))
      yield* Effect.promise(() => screen.findByText('Agent w1 1'))
      yield* wait(SETTLE_MS)

      const before = countedOf(WATCHED_OF_A_CLOCK_SECOND)
      const labelsBefore = RENDER_COUNTS.get('ElapsedLabel') ?? 0

      yield* wait(LONGER_THAN_A_TICK_MS)

      expect(subtract(countedOf(WATCHED_OF_A_CLOCK_SECOND), before)).toEqual([0, 0, 0, 0])
      expect((RENDER_COUNTS.get('ElapsedLabel') ?? 0) - labelsBefore).toBeGreaterThanOrEqual(
        CARDS_ON_A_MACHINE,
      )
    }),
  )
})

describe('the Machines tab', () => {
  it.effect('renders nothing on a clock second while every machine is online', () =>
    Effect.gen(function* () {
      yield* renderApp(MACHINES, liveWith(herd([laptop, deskAt(0)])))
      yield* Effect.promise(() => screen.findByText('laptop'))
      yield* wait(SETTLE_MS)

      const before = countedOf(WATCHED_OF_THE_MACHINE_LIST)

      yield* wait(LONGER_THAN_A_TICK_MS)

      expect(subtract(countedOf(WATCHED_OF_THE_MACHINE_LIST), before)).toEqual([0, 0, 0])
    }),
  )

  it.effect('follows under a machine screen, which renders only for its own machine', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(LAPTOP_DETAIL, liveWith(herd([laptop, deskAt(0)])))

      yield* Effect.promise(() => screen.findByText('About'))
      yield* wait(SETTLE_MS)

      const before = countedOf(WATCHED_OF_THE_MACHINE_LIST)
      const detailBefore = RENDER_COUNTS.get('MachineDetail') ?? 0

      yield* Effect.forEach(
        Arr.range(1, HERD_UPDATES),
        (update) =>
          setsHerd(link, [laptop, deskAt(update)], update).pipe(Effect.andThen(wait(SETTLE_MS))),
        { discard: true },
      )

      expect(subtract(countedOf(WATCHED_OF_THE_MACHINE_LIST), before)[0]).toBeGreaterThan(0)
      expect((RENDER_COUNTS.get('MachineDetail') ?? 0) - detailBefore).toBe(0)

      yield* setsHerd(
        link,
        [machine(LAPTOP, [agent('w1:p1', 'working', { title: 'Now working' })]), deskAt(11)],
        HERD_UPDATES + 1,
      )
      yield* eventually(() => {
        expect((RENDER_COUNTS.get('MachineDetail') ?? 0) - detailBefore).toBeGreaterThan(0)
      })
    }),
  )
})

describe('a herd update from another machine', () => {
  it.effect('renders nothing above the screens', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([laptop, deskAt(0)])))

      yield* eventually(() => {
        expect(RENDER_COUNTS.get('HubGate') ?? 0).toBeGreaterThan(0)
      })
      yield* wait(SETTLE_MS)

      const before = counted()

      yield* Effect.forEach(
        Arr.range(1, HERD_UPDATES),
        (update) =>
          setsHerd(link, [laptop, deskAt(update)], update).pipe(Effect.andThen(wait(SETTLE_MS))),
        { discard: true },
      )

      expect(subtract(counted(), before)).toEqual([0, 0, 0, 0])
    }),
  )

  it.effect('renders nothing of an open chat holding a command, its output and a Sent row', () =>
    Effect.gen(function* () {
      phoneViewport()

      const { link } = yield* renderApp(CHAT, liveWith(herd([laptop, deskAt(0)])))
      const transcript = yield* link.transcriptFor(
        new PaneTranscript({ pane: PaneId.make('w1:p1') }),
      )

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(
          inputDelivered(new Prompt({ pane: PaneId.make('w1:p1'), text: '/rename made up' })),
        ),
      )
      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(
          0,
          20,
          messagesOf(
            [
              '{"type":"user","message":{"content":"<command-name>/color</command-name>"}}',
              '{"type":"user","message":{"content":"<local-command-stdout>Set `orange`</local-command-stdout>"}}',
            ].join('\n'),
          ),
        ),
      ])
      yield* Effect.promise(() => screen.findByText('/color'))
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '/rename made up' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      yield* Effect.promise(() => screen.findByText('Sent'))
      yield* wait(SETTLE_MS)

      const before = countedOf(WATCHED_IN_CHAT)

      yield* Effect.forEach(
        Arr.range(1, HERD_UPDATES),
        (update) =>
          setsHerd(link, [laptop, deskAt(update)], update).pipe(Effect.andThen(wait(SETTLE_MS))),
        { discard: true },
      )

      expect(subtract(countedOf(WATCHED_IN_CHAT), before)).toEqual([0, 0])
      expect(screen.getByText('Sent')).toBeDefined()
    }),
  )

  it.effect(
    'renders nothing of an open chat while its agent works, until its own row changes',
    () =>
      Effect.gen(function* () {
        phoneViewport()

        const workingLaptop = machine(LAPTOP, [
          agent('w1:p1', 'working', { title: 'Stays as it is' }),
        ])
        const { link } = yield* renderApp(CHAT, liveWith(herd([workingLaptop, deskAt(0)])))
        const transcript = yield* link.transcriptFor(
          new PaneTranscript({ pane: PaneId.make('w1:p1') }),
        )

        yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'Fix the herd')])])
        yield* Effect.promise(() => screen.findByText('Fix the herd'))
        yield* wait(SETTLE_MS)

        const before = countedOf(WATCHED_IN_CHAT)

        yield* Effect.forEach(
          Arr.range(1, HERD_UPDATES),
          (update) =>
            setsHerd(link, [workingLaptop, deskAt(update)], update).pipe(
              Effect.andThen(wait(SETTLE_MS)),
            ),
          { discard: true },
        )

        expect(subtract(countedOf(WATCHED_IN_CHAT), before)).toEqual([0, 0])

        yield* setsHerd(
          link,
          [machine(LAPTOP, [agent('w1:p1', 'idle', { title: 'Stays as it is' })]), deskAt(11)],
          HERD_UPDATES + 1,
        )
        yield* eventually(() => {
          expect(subtract(countedOf(WATCHED_IN_CHAT), before)[0]).toBeGreaterThan(0)
        })
      }),
  )
})
