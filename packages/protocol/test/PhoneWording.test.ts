import { describe, expect, it } from '@effect/vitest'
import * as Duration from 'effect/Duration'

import { AskId, MachineId, PaneId } from '@crook/domain/Ids'
import { HubStorageFailed, PaneNotInHerd } from '@crook/protocol/ClientApi'
import {
  AskDialogUnreadable,
  AskNotPending,
  AskOptionUnavailable,
  CommandTimedOut,
  DeclineMessageUndelivered,
  PaneNotAgent,
  PaneNotCreatedByCrook,
  QuestionnaireUnsupported,
  TaskNotDelivered,
} from '@crook/protocol/Commands'

const PANE = PaneId.make('w1:p1')
const ASK = AskId.make('toolu_ask')
const MACHINE = MachineId.make('laptop')
const WORDS_THE_PHONE_NEVER_SHOWS = /w1:p1|toolu_ask|idempotency|CROOK_|disk full/u

const FAILURES_THE_PHONE_SHOWS = [
  new PaneNotInHerd({ machine: MACHINE, pane: PANE }),
  new HubStorageFailed({ detail: 'disk full' }),
  new PaneNotAgent({ pane: PANE }),
  new PaneNotCreatedByCrook({ pane: PANE }),
  new AskNotPending({ pane: PANE, ask: ASK }),
  new AskDialogUnreadable({ pane: PANE }),
  new AskOptionUnavailable({ pane: PANE, option: 'yes' }),
  new QuestionnaireUnsupported({ pane: PANE }),
  new DeclineMessageUndelivered({ pane: PANE, reason: 'herdr stopped answering' }),
  new TaskNotDelivered({ pane: PANE, code: 'agent_not_ready', detail: 'still starting' }),
  new CommandTimedOut({ machine: MACHINE, timeout: Duration.seconds(30) }),
]

describe('a failure the phone shows', () => {
  it('names no pane id, ask id, key, environment variable or raw detail', () => {
    for (const failure of FAILURES_THE_PHONE_SHOWS) {
      expect(failure.message).not.toMatch(WORDS_THE_PHONE_NEVER_SHOWS)
    }
  })

  it('keeps on the wire what its words leave out', () => {
    expect(new HubStorageFailed({ detail: 'disk full' }).detail).toBe('disk full')
    expect(new AskNotPending({ pane: PANE, ask: ASK }).pane).toBe(PANE)
  })
})
