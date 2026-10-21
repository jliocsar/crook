import * as Schema from 'effect/Schema'

export const NotificationEvent = Schema.Literals([
  'approvals',
  'questions',
  'finished',
  'liveActivity',
])
export type NotificationEvent = typeof NotificationEvent.Type

export const HarkDelivery = Schema.Literals(['ready', 'noToken'])
export type HarkDelivery = typeof HarkDelivery.Type

export const NotificationPrefs = Schema.Struct({
  approvals: Schema.Boolean,
  questions: Schema.Boolean,
  finished: Schema.Boolean,
  liveActivity: Schema.Boolean,
})
export type NotificationPrefs = typeof NotificationPrefs.Type

export class NotificationSettings extends Schema.Class<NotificationSettings>(
  'NotificationSettings',
)({
  prefs: NotificationPrefs,
  delivery: HarkDelivery,
}) {}

export const defaultNotificationPrefs: NotificationPrefs = {
  approvals: true,
  questions: true,
  finished: true,
  liveActivity: true,
}

export const withPref = (
  prefs: NotificationPrefs,
  event: NotificationEvent,
  enabled: boolean,
): NotificationPrefs => ({ ...prefs, [event]: enabled })
