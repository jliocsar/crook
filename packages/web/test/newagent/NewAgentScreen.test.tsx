import { describe, expect, it } from '@effect/vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import { AgentStarted, CreateWorktree, StartAgent } from '@crook/domain/Command'
import { MachineId, PaneId } from '@crook/domain/Ids'
import { Checkout, Place } from '@crook/domain/Place'
import { CommandTimedOut, FolderNotFound, TaskNotDelivered } from '@crook/protocol/Commands'

import { COLD_START } from '@crook/web/rpc/HubLinkState'

import { liveWith, renderApp, stateWith } from '../AppRender.tsx'
import { click, eventually, findByRole } from '../Dom.ts'
import { agent, DESK, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const CROOK = '/home/jliocsar/Projects/crook'
const DOTFILES = '/home/jliocsar/dotfiles'
const NEW_PANE = PaneId.make('w1:p9')
const TASK = 'Fix the banner'

const place = (folder: string, minutesAgo: number, branch: string) =>
  new Place({
    folder,
    checkout: Option.some(new Checkout({ branch: Option.some(branch) })),
    usedAt: DateTime.subtractDuration(START, Duration.minutes(minutesAgo)),
  })

const running = [agent('w1:p1', 'working', { title: 'Port the herd screen' })]

const laptop = machine(LAPTOP, running, { places: [place(CROOK, 5, 'main')] })

const laptopWithNewAgent = machine(
  LAPTOP,
  [...running, agent(NEW_PANE, 'unknown', { title: TASK })],
  { places: [place(CROOK, 0, 'main')] },
)

const desk = machine(DESK, [], { places: [place(DOTFILES, 60, 'master')] })

const started = Exit.succeed(new AgentStarted({ pane: NEW_PANE }))

const startInCrook = (task: Option.Option<string>) =>
  new StartAgent({ kind: 'claude', folder: CROOK, task })

const startButton = () => screen.getByRole('button', { name: 'Start Claude' })

const withoutTask = () => screen.getByRole('button', { name: 'Start without a task' })

const typeTask = (text: string) =>
  Effect.promise(() =>
    userEvent.type(screen.getByRole('textbox', { name: 'First message to Claude' }), text),
  )

const sheet = () => within(screen.getByRole('dialog'))

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START.epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NewAgentScreen', () => {
  it.effect('starts Claude with the task, then the chat takes its place in history', () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp('/', liveWith(herd([laptop, desk])))

      yield* click(yield* findByRole('button', 'New agent'))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/new')
      })

      expect(yield* findByRole('heading', 'New agent')).toBeDefined()
      expect(screen.getByText('Claude starts in crook')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Machine, laptop' })).toBeDefined()
      expect(screen.getByRole('button', { name: 'Folder, crook' })).toBeDefined()
      expect(screen.getByRole('button', { name: 'Branch, main' })).toBeDefined()
      expect(screen.queryByRole('button', { name: /kind/iu })).toBeNull()

      yield* Ref.set(link.commandAnswer, started)
      yield* link.commandAnswers.close
      yield* typeTask(TASK)
      yield* click(startButton())

      expect(yield* Effect.promise(() => screen.findByText('Starting Claude…'))).toBeDefined()
      expect(Ref.getUnsafe(link.sent).map((sent) => sent.command)).toEqual([
        startInCrook(Option.some(TASK)),
      ])
      expect(withoutTask()).toHaveProperty('disabled', true)

      yield* link.commandAnswers.open
      yield* Effect.promise(() => screen.findByText('Opening the chat…'))

      expect(router.state.location.pathname).toBe('/new')

      yield* SubscriptionRef.set(link.state, liveWith(herd([laptopWithNewAgent, desk])))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/m/laptop/p/w1%3Ap9')
      })
      router.history.back()
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })
    }),
  )

  it.effect('starts without a task when asked to', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/new', liveWith(herd([laptop])))

      yield* Ref.set(link.commandAnswer, started)
      yield* typeTask('Not this one')
      yield* click(yield* findByRole('button', 'Start without a task'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((sent) => sent.command)).toEqual([
          startInCrook(Option.none()),
        ])
      })
    }),
  )

  it.effect('makes a new worktree on a branch named after the task', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/new', liveWith(herd([laptop])))

      yield* Ref.set(link.commandAnswer, started)
      yield* typeTask(TASK)
      yield* click(yield* findByRole('button', 'Branch, main'))
      yield* click(sheet().getByRole('button', { name: /New worktree/u }))

      const field = sheet().getByRole('textbox', { name: 'Branch name' })

      expect(field).toHaveProperty('value', 'fix-the-banner')

      yield* click(sheet().getByRole('button', { name: 'Done' }))
      yield* eventually(() => {
        expect(screen.queryByRole('dialog')).toBeNull()
      })

      expect(screen.getByRole('button', { name: 'Branch, new: fix-the-banner' })).toBeDefined()
      expect(screen.getByText(/in a new worktree on/u)).toBeDefined()

      yield* click(startButton())
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((sent) => sent.command)).toEqual([
          new CreateWorktree({
            kind: 'claude',
            folder: CROOK,
            branch: 'fix-the-banner',
            task: Option.some(TASK),
          }),
        ])
      })
    }),
  )

  it.effect('names the new worktree after the task until a name is typed', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/new', liveWith(herd([laptop])))

      yield* click(yield* findByRole('button', 'Branch, main'))
      yield* click(sheet().getByRole('button', { name: /New worktree/u }))

      expect(sheet().getByRole('textbox', { name: 'Branch name' })).toHaveProperty('value', '')
      expect(sheet().getByRole('button', { name: 'Done' })).toHaveProperty('disabled', true)

      yield* Effect.promise(() => userEvent.keyboard('{Escape}'))
      yield* eventually(() => {
        expect(screen.queryByRole('dialog')).toBeNull()
      })

      expect(screen.getByRole('button', { name: 'Branch, new: name the branch' })).toBeDefined()
      expect(screen.getByText(/in a new worktree once its branch has a name/u)).toBeDefined()
      expect(withoutTask()).toHaveProperty('disabled', true)

      yield* typeTask(TASK)

      expect(screen.getByRole('button', { name: 'Branch, new: fix-the-banner' })).toBeDefined()

      yield* Ref.set(link.commandAnswer, started)
      yield* click(withoutTask())
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((sent) => sent.command)).toEqual([
          new CreateWorktree({
            kind: 'claude',
            folder: CROOK,
            branch: 'fix-the-banner',
            task: Option.none(),
          }),
        ])
      })
    }),
  )

  it.effect('keeps following the most recent place until the herd is live', () =>
    Effect.gen(function* () {
      const deskNow = machine(DESK, [], { places: [place(DOTFILES, 1, 'master')] })
      const laptopNow = machine(LAPTOP, running, { places: [place(CROOK, 0, 'main')] })
      const deskMoved = machine(DESK, [], { places: [place(DOTFILES, 1, 'trunk')] })
      const { link } = yield* renderApp(
        '/new',
        stateWith(COLD_START, Option.some(herd([laptop, desk]))),
      )

      expect(yield* Effect.promise(() => screen.findByText('Claude starts in crook'))).toBeDefined()

      yield* SubscriptionRef.set(link.state, liveWith(herd([laptop, deskNow])))
      yield* eventually(() => {
        expect(screen.getByText('Claude starts in dotfiles')).toBeDefined()
      })
      yield* SubscriptionRef.set(link.state, liveWith(herd([laptopNow, deskMoved])))
      yield* eventually(() => {
        expect(screen.getByRole('button', { name: 'Branch, trunk' })).toBeDefined()
      })

      expect(screen.getByText('Claude starts in dotfiles')).toBeDefined()
    }),
  )

  it.effect('offers the chat while the new pane has not reached the herd', () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp('/new', liveWith(herd([laptop])))

      yield* Ref.set(link.commandAnswer, started)
      yield* typeTask(TASK)
      yield* click(startButton())
      yield* Effect.promise(() => screen.findByText('Opening the chat…'))
      yield* click(screen.getByRole('button', { name: 'Open the chat' }))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/m/laptop/p/w1%3Ap9')
      })
    }),
  )

  it.effect('disables offline machines in the machine sheet and marks the selected one', () =>
    Effect.gen(function* () {
      const server = machine(MachineId.make('server'), [], {
        connection: 'offline',
        places: [place(DOTFILES, 1, 'main')],
      })

      yield* renderApp('/new', liveWith(herd([laptop, server, desk])))
      yield* click(yield* findByRole('button', 'Machine, laptop'))

      expect(sheet().getByRole('button', { name: /^server/u })).toHaveProperty('disabled', true)
      expect(sheet().getByRole('button', { name: /^desk/u })).toHaveProperty('disabled', false)
      expect(
        sheet()
          .getByRole('button', { name: /^laptop/u })
          .getAttribute('aria-pressed'),
      ).toBe('true')
    }),
  )

  it.effect('picks another machine and its newest folder', () =>
    Effect.gen(function* () {
      yield* renderApp('/new', liveWith(herd([laptop, desk])))
      yield* click(yield* findByRole('button', 'Machine, laptop'))
      yield* click(sheet().getByRole('button', { name: /^desk/u }))
      yield* eventually(() => {
        expect(screen.getByText('Claude starts in dotfiles')).toBeDefined()
      })

      expect(screen.getByRole('button', { name: 'Branch, master' })).toBeDefined()
    }),
  )

  it.effect('says what is missing and keeps Start disabled', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(
        '/new',
        liveWith(herd([machine(LAPTOP, [], { connection: 'offline' })])),
      )

      expect(
        yield* Effect.promise(() => screen.findByText('Every machine is offline')),
      ).toBeDefined()
      expect(withoutTask()).toHaveProperty('disabled', true)

      yield* SubscriptionRef.set(link.state, liveWith(herd([machine(LAPTOP, [])])))

      expect(
        yield* Effect.promise(() => screen.findByText('Pick a folder on laptop')),
      ).toBeDefined()
      expect(withoutTask()).toHaveProperty('disabled', true)

      yield* click(screen.getByRole('button', { name: 'Folder, Pick a folder' }))

      const path = sheet().getByRole('textbox', { name: 'Folder path' })

      yield* Effect.promise(() => userEvent.type(path, '~/Projects/crook'))

      expect(sheet().getByText('Type the full path, starting with /.')).toBeDefined()
      expect(sheet().getByRole('button', { name: 'Use' })).toHaveProperty('disabled', true)

      yield* Effect.promise(() => userEvent.clear(path))
      yield* Effect.promise(() => userEvent.type(path, CROOK))
      yield* click(sheet().getByRole('button', { name: 'Use' }))
      yield* eventually(() => {
        expect(screen.getByText('Claude starts in crook')).toBeDefined()
      })

      expect(withoutTask()).toHaveProperty('disabled', false)
    }),
  )

  it.effect('says why a start failed and retries a timed-out one under the same key', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/new', liveWith(herd([laptop])))
      const refusal = new FolderNotFound({ folder: CROOK })
      const timedOut = new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(45) })

      yield* Ref.set(link.commandAnswer, Exit.fail(timedOut))
      yield* typeTask(TASK)
      yield* click(startButton())

      expect((yield* Effect.promise(() => screen.findByRole('alert'))).textContent).toBe(
        timedOut.message,
      )

      yield* Ref.set(link.commandAnswer, Exit.fail(refusal))
      yield* click(startButton())
      yield* eventually(() => {
        expect(screen.getByRole('alert').textContent).toBe(refusal.message)
      })

      const keys = Ref.getUnsafe(link.sent).map((sent) => sent.key)

      expect(keys).toHaveLength(2)
      expect(keys[1]).toBe(keys[0])
    }),
  )

  it.effect('opens clean after leaving a start that failed', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp('/new', liveWith(herd([laptop])))

      yield* Ref.set(link.commandAnswer, Exit.fail(new FolderNotFound({ folder: CROOK })))
      yield* typeTask(TASK)
      yield* click(startButton())
      yield* Effect.promise(() => screen.findByRole('alert'))
      yield* Effect.promise(() => router.navigate({ to: '/' }))
      yield* eventually(() => {
        expect(screen.queryByRole('alert')).toBeNull()
      })
      yield* Effect.promise(() => router.navigate({ to: '/new' }))
      yield* typeTask(TASK)

      expect(screen.queryByRole('alert')).toBeNull()
      expect(startButton().hasAttribute('disabled')).toBe(false)
    }),
  )

  it.effect('opens the chat of a Claude that started but did not take its task', () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp('/new', liveWith(herd([laptopWithNewAgent])))
      const refusal = new TaskNotDelivered({
        pane: NEW_PANE,
        code: 'agent_not_ready',
        detail: 'the folder trust prompt is open',
      })

      yield* Ref.set(link.commandAnswer, Exit.fail(refusal))
      yield* typeTask(TASK)
      yield* click(startButton())

      const openChat = yield* findByRole('button', 'Open the chat')

      expect(startButton()).toHaveProperty('disabled', true)
      expect(withoutTask()).toHaveProperty('disabled', true)

      yield* typeTask('!')

      expect(startButton()).toHaveProperty('disabled', false)
      expect(withoutTask()).toHaveProperty('disabled', false)

      yield* click(openChat)
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/m/laptop/p/w1%3Ap9')
      })
    }),
  )

  it.effect('sends on Enter from a hardware keyboard and adds a line on a touch one', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/new', liveWith(herd([laptop])))

      yield* Ref.set(link.commandAnswer, started)
      stubMediaQueries(['(prefers-reduced-motion)', '(pointer: coarse)'])
      yield* typeTask('First line{Enter}second line')

      expect(Ref.getUnsafe(link.sent)).toEqual([])
      expect(screen.getByRole('textbox', { name: 'First message to Claude' })).toHaveProperty(
        'value',
        'First line\nsecond line',
      )

      stubMediaQueries(['(prefers-reduced-motion)'])
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'First message to Claude' }), {
        key: 'Enter',
      })
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((sent) => sent.command)).toEqual([
          startInCrook(Option.some('First line\nsecond line')),
        ])
      })
    }),
  )
})
