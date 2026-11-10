import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import type { SqlError } from 'effect/sql/SqlError'
import * as SqlSchema from 'effect/sql/SqlSchema'

import type { MachineId, PaneId } from '@crook/domain/Ids'
import {
  NotificationEvent,
  type NotificationPrefs,
  defaultNotificationPrefs,
  withPref,
} from '@crook/domain/Notifications'
import {
  type StoredRowInvalid,
  dieOnUnencodableRecord,
  storedRowInvalidIn,
} from '@crook/hub/Database'
import { LiveActivityRecord } from '@crook/hub/ActivityPlan'
import { SentNotification } from '@crook/hub/NotificationPlan'

class NotificationPrefRecord extends Schema.Class<NotificationPrefRecord>('NotificationPrefRecord')(
  {
    event: NotificationEvent,
    enabled: Schema.BooleanFromBit,
  },
) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const findPrefs = SqlSchema.findAll({
    Request: Schema.Void,
    Result: NotificationPrefRecord,
    execute: () => sql`SELECT * FROM notification_prefs`,
  })

  const upsertPref = SqlSchema.void({
    Request: NotificationPrefRecord,
    execute: (row) => sql`
      INSERT INTO notification_prefs ${sql.insert(row)}
      ON CONFLICT (event) DO UPDATE SET enabled = excluded.enabled
    `,
  })

  const findSent = SqlSchema.findAll({
    Request: Schema.Void,
    Result: SentNotification,
    execute: () => sql`SELECT * FROM hark_notifications`,
  })

  const upsertSent = SqlSchema.void({
    Request: SentNotification,
    execute: (row) => sql`
      INSERT INTO hark_notifications ${sql.insert(row)}
      ON CONFLICT (machine, pane) DO UPDATE SET
        event = excluded.event,
        terminal = excluded.terminal,
        state_change_seq = excluded.state_change_seq,
        ask = excluded.ask,
        title = excluded.title,
        body = excluded.body,
        hark_id = excluded.hark_id
    `,
  })

  const findLiveActivity = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: LiveActivityRecord,
    execute: () => sql`SELECT last_start_at, shown FROM hark_live_activity WHERE id = 1`,
  })

  const upsertLiveActivity = SqlSchema.void({
    Request: LiveActivityRecord,
    execute: (row) => sql`
      INSERT INTO hark_live_activity ${sql.insert({ id: 1, ...row })}
      ON CONFLICT (id) DO UPDATE SET
        last_start_at = excluded.last_start_at,
        shown = excluded.shown
    `,
  })

  const prefs = findPrefs(undefined).pipe(
    storedRowInvalidIn('notification_prefs'),
    Effect.map(
      Arr.reduce(defaultNotificationPrefs, (current, record) =>
        withPref(current, record.event, record.enabled),
      ),
    ),
    Effect.withSpan('NotificationStore.prefs'),
  )

  const setPref = (event: NotificationEvent, enabled: boolean) =>
    upsertPref(new NotificationPrefRecord({ event, enabled })).pipe(
      dieOnUnencodableRecord,
      Effect.withSpan('NotificationStore.setPref'),
    )

  const sent = findSent(undefined).pipe(
    storedRowInvalidIn('hark_notifications'),
    Effect.withSpan('NotificationStore.sent'),
  )

  const rememberSent = (notification: SentNotification) =>
    upsertSent(notification).pipe(
      dieOnUnencodableRecord,
      Effect.withSpan('NotificationStore.rememberSent'),
    )

  const forgetSent = Effect.fn('NotificationStore.forgetSent')(function* (
    machine: MachineId,
    pane: PaneId,
  ) {
    yield* sql`DELETE FROM hark_notifications WHERE machine = ${machine} AND pane = ${pane}`
  })

  const liveActivity = findLiveActivity(undefined).pipe(
    storedRowInvalidIn('hark_live_activity'),
    Effect.withSpan('NotificationStore.liveActivity'),
  )

  const rememberLiveActivity = (record: LiveActivityRecord) =>
    upsertLiveActivity(record).pipe(
      dieOnUnencodableRecord,
      Effect.withSpan('NotificationStore.rememberLiveActivity'),
    )

  return NotificationStore.of({
    prefs,
    setPref,
    sent,
    rememberSent,
    forgetSent,
    liveActivity,
    rememberLiveActivity,
  })
})

export class NotificationStore extends Context.Service<
  NotificationStore,
  {
    readonly prefs: Effect.Effect<NotificationPrefs, SqlError | StoredRowInvalid>
    readonly setPref: (event: NotificationEvent, enabled: boolean) => Effect.Effect<void, SqlError>
    readonly sent: Effect.Effect<readonly SentNotification[], SqlError | StoredRowInvalid>
    readonly rememberSent: (notification: SentNotification) => Effect.Effect<void, SqlError>
    readonly forgetSent: (machine: MachineId, pane: PaneId) => Effect.Effect<void, SqlError>
    readonly liveActivity: Effect.Effect<
      Option.Option<LiveActivityRecord>,
      SqlError | StoredRowInvalid
    >
    readonly rememberLiveActivity: (record: LiveActivityRecord) => Effect.Effect<void, SqlError>
  }
>()('@crook/hub/NotificationStore') {
  static readonly layer = Layer.effect(this, make)
}
