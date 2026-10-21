import * as Cause from 'effect/Cause'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'

import type { NotificationEvent } from '@crook/domain/Notifications'
import type { StatusTone } from '@crook/web/components/ui/status-pill'
import type { ConnectionNotice, ConnectionView } from '@crook/web/connection/ConnectionView'
import type { HubCallDefected } from '@crook/web/rpc/HubConnection'

export type TestNotificationState = 'idle' | 'sending' | 'sent'

export type SettingsReadFailure = HubCallDefected | Cause.NoSuchElementError

export interface NotificationRow {
  readonly event: NotificationEvent
  readonly label: string
  readonly detail: string
}

export interface HubStatus {
  readonly tone: StatusTone
  readonly label: string
}

export const NOTIFICATION_ROWS: readonly NotificationRow[] = [
  { event: 'approvals', label: 'Approvals', detail: 'Approve or deny from the lock screen' },
  { event: 'questions', label: 'Questions', detail: 'When an agent asks you something' },
  { event: 'finished', label: 'Finished', detail: 'When an agent is done' },
  {
    event: 'liveActivity',
    label: 'Live Activity',
    detail: 'The herd at a glance on the lock screen',
  },
]

const CONNECTED: HubStatus = { tone: 'ok', label: 'connected' }
const CONNECTING: HubStatus = { tone: 'working', label: 'connecting' }

const NOTICE_STATUS = {
  connecting: CONNECTING,
  syncing: { tone: 'working', label: 'syncing' },
  unreachable: { tone: 'warn', label: 'unreachable' },
  offline: { tone: 'idle', label: 'offline' },
  recovered: CONNECTED,
} satisfies Record<ConnectionNotice, HubStatus>

export const hubStatus = (view: ConnectionView): HubStatus =>
  Option.match(view.notice, {
    onNone: () => (view.controlsEnabled ? CONNECTED : CONNECTING),
    onSome: (notice) => NOTICE_STATUS[notice],
  })

export const testNotificationState = <Failure>(
  result: AsyncResult.AsyncResult<void, Failure>,
): TestNotificationState => {
  if (AsyncResult.isWaiting(result)) {
    return 'sending'
  }

  return AsyncResult.isSuccess(result) ? 'sent' : 'idle'
}

export const settledFailure = <Success, Failure extends { readonly message: string }>(
  result: AsyncResult.AsyncResult<Success, Failure>,
): Option.Option<string> =>
  pipe(
    Option.liftPredicate(result, (current) => !AsyncResult.isWaiting(current)),
    Option.flatMap(AsyncResult.cause),
    Option.flatMap(Cause.findErrorOption),
    Option.map((error) => error.message),
  )
