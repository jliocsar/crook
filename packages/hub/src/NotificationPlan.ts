import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as Equivalence from 'effect/Equivalence'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
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
import { PermissionAsk } from '@crook/domain/Ask'
import {
  AskId,
  type GlobalPaneId,
  MachineId,
  PaneId,
  TerminalId,
  toGlobalPaneId,
} from '@crook/domain/Ids'
import { type MachineState, isHerdrLost, isResync } from '@crook/domain/MachineState'
import { NotificationEvent, type NotificationPrefs } from '@crook/domain/Notifications'

import { HARK_IDEMPOTENCY_KEY_LIMIT, HARK_TITLE_LIMIT, HarkId } from '@crook/hub/HarkClient'

interface RaisedEvent {
  readonly event: AgentNotificationEvent
  readonly ask: Option.Option<AskId>
  readonly verb: string
}

export type NotificationsByPane<Notification> = HashMap.HashMap<GlobalPaneId, Notification>

export type NotificationStep = Data.TaggedEnum<{
  Withdraw: { readonly sent: SentNotification }
  Send: { readonly wanted: WantedNotification }
  Drop: { readonly wanted: WantedNotification }
}>

export const AgentNotificationEvent = NotificationEvent.pick(['approvals', 'questions', 'finished'])
export type AgentNotificationEvent = typeof AgentNotificationEvent.Type

export class WantedNotification extends Schema.Class<WantedNotification>('WantedNotification')({
  machine: MachineId,
  pane: PaneId,
  event: AgentNotificationEvent,
  terminal: TerminalId,
  stateChangeSeq: StateChangeSeq,
  ask: Schema.OptionFromNullOr(AskId),
  title: Schema.String,
  body: Schema.String,
}) {}

export class SentNotification extends Schema.Class<SentNotification>('SentNotification')({
  ...WantedNotification.fields,
  harkId: HarkId,
}) {}

export const NotificationStep = Data.taggedEnum<NotificationStep>()

const DANGLING_HIGH_SURROGATE = /[\uD800-\uDBFF]$/u
const FINISHED: RaisedEvent = { event: 'finished', ask: Option.none(), verb: 'Finished' }
const QUESTION: RaisedEvent = { event: 'questions', ask: Option.none(), verb: 'Has a question' }

const isSameAsk = Option.makeEquivalence(Equivalence.String)

const isSameRaised = Option.makeEquivalence(
  Equivalence.Struct({ event: Equivalence.String, ask: isSameAsk }),
)

export const permissionOf = (row: AgentRow): Option.Option<PermissionAsk> =>
  Option.filter(row.ask, Schema.is(PermissionAsk))

const blockedEvent = (row: AgentRow): RaisedEvent =>
  Option.match(permissionOf(row), {
    onNone: () => QUESTION,
    onSome: (permission) => ({
      event: 'approvals',
      ask: Option.some(permission.id),
      verb: `Wants to run ${permission.tool}`,
    }),
  })

export const raisedEventOf = (row: AgentRow): Option.Option<RaisedEvent> =>
  Match.value(row.status).pipe(
    Match.when('done', () => Option.some(FINISHED)),
    Match.when('blocked', () => Option.some(blockedEvent(row))),
    Match.orElse(() => Option.none()),
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

export const cutForHark = (text: string, limit: number): string =>
  pipe(Str.takeLeft(text, limit), Str.replace(DANGLING_HIGH_SURROGATE, ''))

export const harkTitleOf = (title: string): string => cutForHark(title, HARK_TITLE_LIMIT)

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
  ask: isSameAsk,
})

export const isApproval = (notification: WantedNotification): boolean =>
  notification.event === 'approvals'

export const identityOf = (notification: WantedNotification): string =>
  [
    'crook',
    notification.machine,
    notification.pane,
    notification.terminal,
    String(notification.stateChangeSeq),
    notification.event,
    ...Option.toArray(notification.ask),
  ].join('/')

export const idempotencyKeyOf = (notification: WantedNotification): Option.Option<string> =>
  Option.liftPredicate(identityOf(notification), (key) => key.length <= HARK_IDEMPOTENCY_KEY_LIMIT)

const wantedFor = (
  state: MachineState,
  machineLabel: string,
  row: AgentRow,
  raised: RaisedEvent,
) => {
  const mark = seenMarkOf(row)

  return new WantedNotification({
    machine: state.machine,
    pane: row.pane,
    event: raised.event,
    terminal: mark.terminal,
    stateChangeSeq: mark.stateChangeSeq,
    ask: raised.ask,
    title: harkTitleOf(agentTitleOrPane(row)),
    body: `${raised.verb} · ${machineLabel} / ${workspaceLabelOf(state, row)}`,
  })
}

const hasMovedOn = (before: AgentRow, row: AgentRow) => {
  const status = settledStatus(before)
  const askedSomethingElse =
    Option.isNone(before.beforeHandoff) && !isSameRaised(raisedEventOf(before), raisedEventOf(row))

  return (
    status !== 'unknown' &&
    (status !== row.status ||
      !isSameSeenMark(seenMarkOf(before), seenMarkOf(row)) ||
      askedSomethingElse)
  )
}

const raisedEvent = (previous: MachineState, row: AgentRow) =>
  pipe(
    Option.liftPredicate(row, (candidate) => Option.isNone(candidate.beforeHandoff)),
    Option.flatMap(raisedEventOf),
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
          Option.map(raisedEvent(previous, row), (raised) =>
            wantedFor(next, machineLabel, row, raised),
          ),
        ),
        Arr.getSomes,
      )

const isRaisedBy = (wanted: WantedNotification) => (raised: RaisedEvent) =>
  raised.event === wanted.event && isSameAsk(raised.ask, wanted.ask)

const isSeenIn = (seen: HashSet.HashSet<PaneId>, wanted: WantedNotification) =>
  !isApproval(wanted) && HashSet.has(seen, wanted.pane)

export const isStillWanted = (
  wanted: WantedNotification,
  next: MachineState,
  seen: HashSet.HashSet<PaneId>,
): boolean => {
  if (isHerdrLost(next)) {
    return true
  }

  if (isSeenIn(seen, wanted)) {
    return false
  }

  return Option.match(rowIn(next, wanted.pane), {
    onNone: () => false,
    onSome: (row) => {
      if (row.status === 'unknown') {
        return true
      }

      return (
        Option.exists(raisedEventOf(row), isRaisedBy(wanted)) &&
        isSameSeenMark(seenMarkOf(row), wanted)
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
): NotificationsByPane<WantedNotification> =>
  Option.match(HashMap.get(wanted, toGlobalPaneId(machine, pane)), {
    onNone: () => wanted,
    onSome: (notification) =>
      isApproval(notification) ? wanted : HashMap.remove(wanted, notificationKey(notification)),
  })

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
