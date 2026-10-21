import { describe, expect, it } from '@effect/vitest'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'

import { StartAgent } from '@crook/domain/Command'
import { IdempotencyKey, PaneId } from '@crook/domain/Ids'
import {
  AgentNotStarted,
  CommandDeliveryUnknown,
  CommandTimedOut,
  FolderNotFound,
  TaskNotDelivered,
} from '@crook/protocol/Commands'
import { LaunchAttempt } from '@crook/web/atoms/Launch'
import type { LaunchFailure } from '@crook/web/atoms/Launch'
import { mintIdempotencyKey, retryKey } from '@crook/web/newagent/LaunchKey'
import { HubConnectionLost } from '@crook/web/rpc/HubConnection'

import { DESK, LAPTOP } from '../HerdFixtures.ts'

const CROOK = '/home/jliocsar/Projects/crook'

const startIn = (folder: string) =>
  new StartAgent({ kind: 'claude', folder, task: Option.some('Fix the banner') })

const sentKey = IdempotencyKey.make('9d2c41aa')

const sent = Option.some(
  new LaunchAttempt({ key: sentKey, machine: LAPTOP, command: startIn(CROOK) }),
)

const retryAfter = (failure: LaunchFailure) =>
  retryKey(sent, Option.some(failure), LAPTOP, startIn(CROOK))

describe('retryKey', () => {
  it('reuses the key when the same start failed without a remembered outcome', () => {
    expect(
      retryAfter(new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(1) })),
    ).toEqual(Option.some(sentKey))
    expect(retryAfter(new HubConnectionLost({ detail: 'socket closed' }))).toEqual(
      Option.some(sentKey),
    )
    expect(retryAfter(new FolderNotFound({ folder: CROOK }))).toEqual(Option.some(sentKey))
  })

  it('takes a new key once the agent remembers how the start ended', () => {
    const pane = PaneId.make('w1:p9')

    expect(
      retryAfter(
        new AgentNotStarted({
          folder: CROOK,
          worktree: Option.none(),
          code: 'agent_not_ready',
          detail: 'timed out',
        }),
      ),
    ).toEqual(Option.none())
    expect(
      retryAfter(new TaskNotDelivered({ pane, code: 'agent_not_ready', detail: 'trust prompt' })),
    ).toEqual(Option.none())
    expect(retryAfter(new CommandDeliveryUnknown())).toEqual(Option.none())
  })

  it('takes a new key for another start, another machine, a first start or a success', () => {
    const timedOut = Option.some<LaunchFailure>(
      new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(1) }),
    )

    expect(retryKey(sent, timedOut, LAPTOP, startIn('/home/jliocsar/dotfiles'))).toEqual(
      Option.none(),
    )
    expect(retryKey(sent, timedOut, DESK, startIn(CROOK))).toEqual(Option.none())
    expect(retryKey(Option.none(), timedOut, LAPTOP, startIn(CROOK))).toEqual(Option.none())
    expect(retryKey(sent, Option.none(), LAPTOP, startIn(CROOK))).toEqual(Option.none())
  })
})

describe('mintIdempotencyKey', () => {
  it('mints a fresh 128-bit hex key each time', () => {
    const first = mintIdempotencyKey()

    expect(first).toMatch(/^[0-9a-f]{32}$/u)
    expect(mintIdempotencyKey()).not.toBe(first)
  })
})
