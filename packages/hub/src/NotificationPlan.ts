import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as Equivalence from 'effect/Equivalence'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import {
  type AgentRow,
  StateChangeSeq,
  agentTitleOrPane,
  isSameSeenMark,
  seenMarkOf,
} from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { type GlobalPaneId, MachineId, PaneId, TerminalId, toGlobalPaneId } from '@crook/domain/Ids'
import { type MachineState, isHerdrLost, isResync } from '@crook/domain/MachineState'
import { NotificationEvent, type NotificationPrefs } from '@crook/domain/Notifications'

import {
  HARK_IDEMPOTENCY_KEY_LIMIT,
  HARK_TITLE_LIMIT,
  HarkNotificationId,
} from '@crook/hub/HarkClient'

export type NotificationsByPane<Notification> = HashMap.HashMap<GlobalPaneId, Notification>

export type NotificationStep = Data.TaggedEnum<{
  Withdraw: { readonly sent: SentNotification }
  Send: { readonly wanted: WantedNotification }
  Drop: { readonly wanted: WantedNotification }
}>

export const PlainNotificationEvent = NotificationEvent.pick(['questions', 'finished'])
export type PlainNotificationEvent = typeof PlainNotificationEvent.Type

export class WantedNotification extends Schema.Class<WantedNotification>('WantedNotification')({
  machine: MachineId,
  pane: PaneId,
  event: PlainNotificationEvent,
  terminal: TerminalId,
  stateChangeSeq: StateChangeSeq,
  title: Schema.String,
  body: Schema.String,
}) {}

export class SentNotification extends Schema.Class<SentNotification>('SentNotification')({
  ...WantedNotification.fields,
  harkId: HarkNotificationId,
}) {}

export const NotificationStep = Data.taggedEnum<NotificationStep>()

const DANGLING_HIGH_SURROGATE = /[\uD800-\uDBFF]$/u

const PLAIN_EVENTS = {
  questions: { status: 'blocked', verb: 'Has a question' },
  finished: { status: 'done', verb: 'Finished' },
} satisfies Record.ReadonlyRecord<
  PlainNotificationEvent,
  { readonly status: AgentStatus; readonly verb: string }
>

const eventOfStatus = (status: AgentStatus): Option.Option<PlainNotificationEvent> =>
  Option.map(
    Record.findFirst(PLAIN_EVENTS, (plain) => plain.status === status),
    ([event]) => event,
  )

const settledStatus = (row: AgentRow): AgentStatus =>
  Option.match(row.beforeHandoff, {
    onNone: () => row.status,
    onSome: (before) => before.status,
  })

const rowIn = (state: MachineState, pane: PaneId) =>
  Arr.findFirst(state.agents, (row) => row.pane === pane)

const workspaceLabelOf = (state: MachineState, row: AgentRow) =>
  pipe(
    Arr.findFirst(state.workspaces, (workspace) => workspace.id === row.workspace),
    Option.map((workspace) => workspace.label),
    Option.getOrElse((): string => row.workspace),
  )

export const harkTitleOf = (title: string): string =>
  pipe(Str.takeLeft(title, HARK_TITLE_LIMIT), Str.replace(DANGLING_HIGH_SURROGATE, ''))

export const notificationKey = (notification: {
  readonly machine: MachineId
  readonly pane: PaneId
}) => toGlobalPaneId(notification.machine, notification.pane)

export const isSameNotification: Equivalence.Equivalence<WantedNotification> = Equivalence.Struct({
  machine: Equivalence.String,
  pane: Equivalence.String,
  event: Equivalence.String,
  terminal: Equivalence.String,
  stateChangeSeq: Equivalence.Number,
})

export const identityOf = (notification: WantedNotification): string =>
  [
    'crook',
    notification.machine,
    notification.pane,
    notification.terminal,
    String(notification.stateChangeSeq),
    notification.event,
  ].join('/')

export const idempotencyKeyOf = (notification: WantedNotification): Option.Option<string> =>
  Option.liftPredicate(identityOf(notification), (key) => key.length <= HARK_IDEMPOTENCY_KEY_LIMIT)

const wantedFor = (
  state: MachineState,
  machineLabel: string,
  row: AgentRow,
  event: PlainNotificationEvent,
) => {
  const mark = seenMarkOf(row)

  return new WantedNotification({
    machine: state.machine,
    pane: row.pane,
    event,
    terminal: mark.terminal,
    stateChangeSeq: mark.stateChangeSeq,
    title: harkTitleOf(agentTitleOrPane(row)),
    body: `${PLAIN_EVENTS[event].verb} · ${machineLabel} / ${workspaceLabelOf(state, row)}`,
  })
}

const hasMovedOn = (before: AgentRow, row: AgentRow) => {
  const status = settledStatus(before)

  return (
    status !== 'unknown' &&
    (status !== row.status || !isSameSeenMark(seenMarkOf(before), seenMarkOf(row)))
  )
}

const raisedEvent = (previous: MachineState, row: AgentRow) =>
  pipe(
    Option.liftPredicate(row, (candidate) => Option.isNone(candidate.beforeHandoff)),
    Option.flatMap((candidate) => eventOfStatus(candidate.status)),
    Option.filter(() =>
      Option.exists(rowIn(previous, row.pane), (before) => hasMovedOn(before, row)),
    ),
  )

export const raisedBetween = (
  previous: MachineState,
  next: MachineState,
  machineLabel: string,
): readonly WantedNotification[] =>
  isResync(previous, next) || isHerdrLost(next)
    ? []
    : pipe(
        next.agents,
        Arr.map((row) =>
          Option.map(raisedEvent(previous, row), (event) =>
            wantedFor(next, machineLabel, row, event),
          ),
        ),
        Arr.getSomes,
      )

export const isStillWanted = (
  wanted: WantedNotification,
  next: MachineState,
  seen: HashSet.HashSet<PaneId>,
): boolean => {
  if (isHerdrLost(next)) {
    return true
  }

  if (HashSet.has(seen, wanted.pane)) {
    return false
  }

  return Option.match(rowIn(next, wanted.pane), {
    onNone: () => false,
    onSome: (row) => {
      if (row.status === 'unknown') {
        return true
      }

      return (
        row.status === PLAIN_EVENTS[wanted.event].status && isSameSeenMark(seenMarkOf(row), wanted)
      )
    },
  })
}

export const afterPublish = (
  wanted: NotificationsByPane<WantedNotification>,
  change: {
    readonly machineLabel: string
    readonly previous: Option.Option<MachineState>
    readonly next: MachineState
    readonly seen: HashSet.HashSet<PaneId>
  },
): NotificationsByPane<WantedNotification> => {
  const kept = HashMap.filter(
    wanted,
    (notification) =>
      notification.machine !== change.next.machine ||
      isStillWanted(notification, change.next, change.seen),
  )
  const raised = Option.match(change.previous, {
    onNone: (): readonly WantedNotification[] => [],
    onSome: (previous) => raisedBetween(previous, change.next, change.machineLabel),
  })

  return pipe(
    raised,
    Arr.reduce(kept, (byPane, notification) =>
      HashMap.set(byPane, notificationKey(notification), notification),
    ),
  )
}

export const afterSeen = (
  wanted: NotificationsByPane<WantedNotification>,
  machine: MachineId,
  pane: PaneId,
): NotificationsByPane<WantedNotification> => HashMap.remove(wanted, toGlobalPaneId(machine, pane))

export const afterForgotten = (
  wanted: NotificationsByPane<WantedNotification>,
  machine: MachineId,
): NotificationsByPane<WantedNotification> =>
  HashMap.filter(wanted, (notification) => notification.machine !== machine)

export const nextStep = (
  wanted: NotificationsByPane<WantedNotification>,
  sent: NotificationsByPane<SentNotification>,
  abandoned: HashSet.HashSet<string>,
  prefs: NotificationPrefs,
): Option.Option<NotificationStep> => {
  const outdated = Arr.findFirst(
    HashMap.toValues(sent),
    (notification) =>
      !Option.exists(HashMap.get(wanted, notificationKey(notification)), (current) =>
        isSameNotification(current, notification),
      ),
  )
  const unsent = Arr.findFirst(
    HashMap.toValues(wanted),
    (notification) =>
      !HashSet.has(abandoned, identityOf(notification)) &&
      !Option.exists(HashMap.get(sent, notificationKey(notification)), (current) =>
        isSameNotification(notification, current),
      ),
  )

  return Option.match(outdated, {
    onSome: (notification) => Option.some(NotificationStep.Withdraw({ sent: notification })),
    onNone: () =>
      Option.map(unsent, (notification) =>
        prefs[notification.event]
          ? NotificationStep.Send({ wanted: notification })
          : NotificationStep.Drop({ wanted: notification }),
      ),
  })
}
