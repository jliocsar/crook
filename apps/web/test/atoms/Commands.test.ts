import { describe, expect, it } from 'vitest'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Cause from 'effect/Cause'

import { Prompt } from '@crook/domain/Command'
import type { CommandReceipt } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import { MachineNotInHerd } from '@crook/protocol/ClientApi'
import { UNEXPECTED_FAILURE_MESSAGE } from '@crook/web/atoms/ActionFailure'
import { ActionProgress } from '@crook/web/atoms/ActionProgress'
import { pendingAction } from '@crook/web/atoms/Commands'

import { agent, herd, LAPTOP, machine } from '../HerdFixtures.ts'
import { inputDelivered } from '../HubFakes.ts'

const PANE = PaneId.make('w1:p1')

const receipt = inputDelivered(new Prompt({ pane: PANE, text: 'go' }))

const herdWith = (seq: number) =>
  Option.some(herd([machine(LAPTOP, [agent('w1:p1', 'working', { seq })])]))

const stateOf = (
  result: AsyncResult.AsyncResult<CommandReceipt, { readonly message: string }>,
  view = herdWith(1),
) => pendingAction(result, view, LAPTOP)

describe('pendingAction', () => {
  it('is idle before anything is sent, and sending while the hub has not answered', () => {
    expect(stateOf(AsyncResult.initial())).toStrictEqual(ActionProgress.Idle())
    expect(stateOf(AsyncResult.initial(true))).toStrictEqual(ActionProgress.Sending())
  })

  it('is sent on the ack, and done once the pane has moved since', () => {
    expect(stateOf(AsyncResult.success(receipt))).toStrictEqual(ActionProgress.Sent({ receipt }))
    expect(stateOf(AsyncResult.success(receipt), herdWith(2))).toStrictEqual(
      ActionProgress.Done({ receipt }),
    )
    expect(
      stateOf(AsyncResult.success(receipt), Option.some(herd([machine(LAPTOP, [])]))),
    ).toStrictEqual(ActionProgress.Done({ receipt }))
  })

  it('stays sent on the ack while no herd has arrived to show it in', () => {
    expect(stateOf(AsyncResult.success(receipt), Option.none())).toStrictEqual(
      ActionProgress.Sent({ receipt }),
    )
  })

  it('says why it failed, and gives the one unexpected-failure sentence when no error came back', () => {
    const refusal = new MachineNotInHerd({ machine: LAPTOP })

    expect(stateOf(AsyncResult.fail(refusal))).toStrictEqual(
      ActionProgress.Failed({ message: refusal.message, asksConfirmation: false }),
    )
    expect(stateOf(AsyncResult.failure(Cause.die('torn frame')))).toStrictEqual(
      ActionProgress.Failed({ message: UNEXPECTED_FAILURE_MESSAGE, asksConfirmation: false }),
    )
  })
})
