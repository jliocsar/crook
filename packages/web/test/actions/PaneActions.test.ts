import { describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Result from 'effect/Result'
import * as Duration from 'effect/Duration'
import * as Struct from 'effect/Struct'

import { PaneClosed, PaneRenamed } from '@crook/domain/Command'
import type { CommandReceipt } from '@crook/domain/Command'
import { HerdMachine } from '@crook/domain/HerdView'
import { HubStorageFailed } from '@crook/protocol/ClientApi'
import {
  CommandDeliveryUnknown,
  CommandTimedOut,
  PaneNotCreatedByCrook,
} from '@crook/protocol/Commands'
import {
  ActionProgress,
  CLAUDE_EXITED_NOTICE,
  closeNeedsConfirmation,
  commandProgress,
  endedNotice,
  failureOf,
  InvalidPaneLabel,
  isConfirmationAsked,
  isRetriableFailure,
  keepsName,
  labelFromInput,
  PANE_CLOSED_NOTICE,
  pinProgress,
  SheetOutcome,
  sheetOutcome,
  UNEXPLAINED_FAILURE,
} from '@crook/web/actions/PaneActions'
import type { SendCommandFailure, SetPinnedFailure } from '@crook/web/actions/PaneActions'
import { HubConnectionLost } from '@crook/web/rpc/HubConnection'

import { agent, LAPTOP, machine } from '../HerdFixtures.ts'

const pane = agent('w1:p1', 'idle').pane
const named = agent('w1:p1', 'idle', { label: 'Payments' })
const renamed = new PaneRenamed({ pane, label: Option.some('Payments') })

const acked = (receipt: CommandReceipt) =>
  AsyncResult.success<CommandReceipt, SendCommandFailure>(receipt)

const refused = (error: SendCommandFailure) =>
  AsyncResult.failure<CommandReceipt, SendCommandFailure>(Cause.fail(error))

describe('commandProgress', () => {
  it('is idle before the action, sending while it waits, sent once acked, done once shown', () => {
    expect(commandProgress(AsyncResult.initial(), [])).toEqual(ActionProgress.Idle())
    expect(commandProgress(AsyncResult.initial(true), [])).toEqual(ActionProgress.Sending())
    expect(commandProgress(acked(renamed), [agent('w1:p1', 'idle')])).toEqual(ActionProgress.Sent())
    expect(commandProgress(acked(renamed), [named])).toEqual(ActionProgress.Done())
    expect(commandProgress(acked(new PaneClosed({ pane })), [])).toEqual(ActionProgress.Done())
  })

  it('names a refusal and asks to confirm a foreign pane', () => {
    const timedOut = commandProgress(
      refused(new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(10) })),
      [],
    )
    const unknown = commandProgress(refused(new CommandDeliveryUnknown()), [])
    const foreign = commandProgress(refused(new PaneNotCreatedByCrook({ pane })), [])

    expect(timedOut).toEqual(
      ActionProgress.Failed({
        message: new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(10) }).message,
        asksConfirmation: false,
      }),
    )
    expect(unknown).toEqual(
      ActionProgress.Failed({
        message: new CommandDeliveryUnknown().message,
        asksConfirmation: false,
      }),
    )
    expect(isConfirmationAsked(foreign)).toBe(true)
    expect(failureOf(foreign)).toEqual(Option.none())
    expect(failureOf(unknown)).toEqual(Option.some(new CommandDeliveryUnknown().message))
  })

  it('reads an interruption as nothing having happened', () => {
    expect(
      commandProgress(
        AsyncResult.failure<CommandReceipt, SendCommandFailure>(Cause.interrupt()),
        [],
      ),
    ).toEqual(ActionProgress.Idle())
  })

  it('retries under the same key only after a failure that may have reached the machine', () => {
    expect(isRetriableFailure(refused(new HubConnectionLost({ detail: 'socket closed' })))).toBe(
      true,
    )
    expect(isRetriableFailure(refused(new CommandDeliveryUnknown()))).toBe(false)
    expect(isRetriableFailure(acked(renamed))).toBe(false)
  })

  it('keeps the key after a failure that says nothing, which it reports as unexplained', () => {
    const died = AsyncResult.failure<CommandReceipt, SendCommandFailure>(
      Cause.die(new Error('handler crashed')),
    )

    expect(isRetriableFailure(died)).toBe(true)
    expect(failureOf(commandProgress(died, []))).toEqual(Option.some(UNEXPLAINED_FAILURE))
    expect(
      isRetriableFailure(
        AsyncResult.failure<CommandReceipt, SendCommandFailure>(Cause.interrupt()),
      ),
    ).toBe(false)
  })
})

describe('pinProgress', () => {
  it('is done once the herd shows the pin the hub was asked for', () => {
    const pinned = AsyncResult.success<boolean, SetPinnedFailure>(true)

    expect(pinProgress(pinned, false)).toEqual(ActionProgress.Sent())
    expect(pinProgress(pinned, true)).toEqual(ActionProgress.Done())
    expect(
      failureOf(
        pinProgress(
          AsyncResult.failure(Cause.fail(new HubStorageFailed({ detail: 'disk full' }))),
          false,
        ),
      ),
    ).toEqual(Option.some(new HubStorageFailed({ detail: 'disk full' }).message))
  })
})

describe('labelFromInput', () => {
  it('trims the name, turns a blank one into clearing it, and refuses control characters', () => {
    expect(labelFromInput('  Payments ')).toEqual(Result.succeed(Option.some('Payments')))
    expect(labelFromInput('   ')).toEqual(Result.succeed(Option.none()))
    expect(labelFromInput('Pay\tments')).toEqual(Result.fail(new InvalidPaneLabel()))
  })

  it('knows a name that changes nothing', () => {
    expect(keepsName(named, Option.some('Payments'))).toBe(true)
    expect(keepsName(agent('w1:p1', 'idle', { title: 'Wire it' }), Option.some('Wire it'))).toBe(
      true,
    )
    expect(keepsName(agent('w1:p1', 'idle'), Option.none())).toBe(true)
    expect(keepsName(named, Option.none())).toBe(false)
  })
})

describe('sheetOutcome', () => {
  const laptop = machine(LAPTOP, [agent('w1:p1', 'idle')], { shellPanes: ['w1:p2'] })
  const emptied = machine(LAPTOP, [], { shellPanes: ['w1:p2'] })
  const sheet = {
    herdMachine: Option.some(laptop),
    pane,
    rename: ActionProgress.Idle(),
    close: ActionProgress.Idle(),
    pin: ActionProgress.Idle(),
  }

  it('tells a pane that closed from Claude exiting in a pane that is still there', () => {
    expect(endedNotice(Option.some(laptop), pane)).toEqual(Option.none())
    expect(endedNotice(Option.some(emptied), pane)).toEqual(Option.some(PANE_CLOSED_NOTICE))
    expect(endedNotice(Option.some(emptied), agent('w1:p2', 'idle').pane)).toEqual(
      Option.some(CLAUDE_EXITED_NOTICE),
    )
  })

  it('stays open, finishes after a rename or pin, and ends when the agent goes on its own', () => {
    expect(sheetOutcome(sheet)).toEqual(SheetOutcome.Stay())
    expect(sheetOutcome({ ...sheet, rename: ActionProgress.Done() })).toEqual(
      SheetOutcome.Finished(),
    )
    expect(sheetOutcome({ ...sheet, herdMachine: Option.some(emptied) })).toEqual(
      SheetOutcome.Ended({ notice: PANE_CLOSED_NOTICE }),
    )
  })

  it('stays open after a rename or pin while a failed close is still on screen', () => {
    const refusedClose = ActionProgress.Failed({ message: 'Refused.', asksConfirmation: true })

    expect(sheetOutcome({ ...sheet, pin: ActionProgress.Done(), close: refusedClose })).toEqual(
      SheetOutcome.Stay(),
    )
    expect(sheetOutcome({ ...sheet, rename: ActionProgress.Done(), close: refusedClose })).toEqual(
      SheetOutcome.Stay(),
    )
  })

  it('stays open after a rename or pin while the other one is still out or failed', () => {
    const refusedRename = ActionProgress.Failed({ message: 'Refused.', asksConfirmation: false })

    expect(
      sheetOutcome({ ...sheet, pin: ActionProgress.Done(), rename: ActionProgress.Sending() }),
    ).toEqual(SheetOutcome.Stay())
    expect(
      sheetOutcome({ ...sheet, pin: ActionProgress.Done(), rename: ActionProgress.Sent() }),
    ).toEqual(SheetOutcome.Stay())
    expect(sheetOutcome({ ...sheet, pin: ActionProgress.Done(), rename: refusedRename })).toEqual(
      SheetOutcome.Stay(),
    )
    expect(
      sheetOutcome({ ...sheet, rename: ActionProgress.Done(), pin: ActionProgress.Sending() }),
    ).toEqual(SheetOutcome.Stay())
    expect(
      sheetOutcome({ ...sheet, rename: ActionProgress.Done(), pin: ActionProgress.Done() }),
    ).toEqual(SheetOutcome.Finished())
  })

  it('stays open while the machine state is unknown, as it is after a hub restart', () => {
    const unknown = new HerdMachine(Struct.evolve(laptop, { state: () => Option.none() }))

    expect(sheetOutcome({ ...sheet, herdMachine: Option.some(unknown) })).toEqual(
      SheetOutcome.Stay(),
    )
    expect(sheetOutcome({ ...sheet, herdMachine: Option.none() })).toEqual(SheetOutcome.Stay())
  })

  it('counts the agent going as its own close while that close is underway', () => {
    expect(
      sheetOutcome({
        ...sheet,
        herdMachine: Option.some(emptied),
        close: ActionProgress.Sending(),
      }),
    ).toEqual(SheetOutcome.Stay())
    expect(
      sheetOutcome({ ...sheet, herdMachine: Option.some(emptied), close: ActionProgress.Done() }),
    ).toEqual(SheetOutcome.Closed())
  })
})

describe('closeNeedsConfirmation', () => {
  const created = agent('w1:p1', 'idle', { createdByCrook: true })
  const foreign = agent('w1:p1', 'idle')
  const confirmed = Option.some({ confirmed: true })
  const unconfirmed = Option.some({ confirmed: false })
  const askedToConfirm = ActionProgress.Failed({ message: 'Not ours.', asksConfirmation: true })

  it('asks before the first close of a pane crook did not create', () => {
    expect(closeNeedsConfirmation(foreign, ActionProgress.Idle(), Option.none())).toBe(true)
    expect(closeNeedsConfirmation(created, ActionProgress.Idle(), Option.none())).toBe(false)
    expect(closeNeedsConfirmation(created, ActionProgress.Sending(), unconfirmed)).toBe(false)
  })

  it('asks once the agent says crook did not create the pane', () => {
    expect(closeNeedsConfirmation(created, askedToConfirm, unconfirmed)).toBe(true)
  })

  it('keeps asking after a confirmed attempt, so its retry stays confirmed', () => {
    const timedOut = ActionProgress.Failed({ message: 'Timed out.', asksConfirmation: false })

    expect(closeNeedsConfirmation(created, timedOut, confirmed)).toBe(true)
  })
})
