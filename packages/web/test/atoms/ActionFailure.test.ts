import { describe, expect, it } from '@effect/vitest'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'

import { PaneId } from '@crook/domain/Ids'
import {
  AgentNotStarted,
  CommandDeliveryUnknown,
  CommandTimedOut,
  DeclineMessageUndelivered,
  MachineOffline,
  PaneNotAgent,
  PaneNotCreatedByCrook,
  TaskNotDelivered,
} from '@crook/protocol/Commands'
import { remembersOutcome } from '@crook/web/atoms/ActionFailure'
import { HubCallDefected, HubConnectionLost } from '@crook/web/rpc/HubConnection'
import { HubNotConnected } from '@crook/web/rpc/HubLink'

import { LAPTOP } from '../HerdFixtures.ts'

const pane = PaneId.make('w1:p1')

describe('remembersOutcome', () => {
  it('holds for the failures the agent replays under the same key', () => {
    expect(
      remembersOutcome(
        new AgentNotStarted({
          folder: '/home/jliocsar/Projects/crook',
          worktree: Option.none(),
          code: 'agent_not_ready',
          detail: 'timed out',
        }),
      ),
    ).toBe(true)
    expect(
      remembersOutcome(new TaskNotDelivered({ pane, code: 'agent_not_ready', detail: 'trust' })),
    ).toBe(true)
    expect(remembersOutcome(new CommandDeliveryUnknown())).toBe(true)
    expect(remembersOutcome(new DeclineMessageUndelivered({ pane, reason: 'stalled' }))).toBe(true)
  })

  it('fails for a refusal the agent forgets, and for every failure short of the agent', () => {
    expect(remembersOutcome(new PaneNotCreatedByCrook({ pane }))).toBe(false)
    expect(remembersOutcome(new PaneNotAgent({ pane }))).toBe(false)
    expect(remembersOutcome(new MachineOffline({ machine: LAPTOP }))).toBe(false)
    expect(
      remembersOutcome(new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(10) })),
    ).toBe(false)
    expect(remembersOutcome(new HubConnectionLost({ detail: 'socket closed' }))).toBe(false)
    expect(remembersOutcome(new HubCallDefected({ cause: new Error('handler crashed') }))).toBe(
      false,
    )
    expect(remembersOutcome(new HubNotConnected())).toBe(false)
  })
})
