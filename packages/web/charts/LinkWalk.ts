import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as DateTime from 'effect/DateTime'

import { HerdView } from '@crook/domain/HerdView'
import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import {
  allowsActions,
  connectionView,
  dimsContent,
  noticeOf,
  syncedAtOf,
} from '@crook/web/connection/ConnectionView'
import { caseName } from '@crook/web/machine/Machine'
import type { WalkSpec } from '@crook/web/machine/Walk'
import {
  ATTEMPT_BEGAN,
  CONNECTION_DROPPED,
  DIAL_REFUSED,
  HERD_RECEIVED,
  HubLinkState,
  LinkEvent,
  linkMachine,
  LinkStatus,
  LOGGED_OUT_CONFIRMED,
  NOTICE_DELAY_PASSED,
  PAGE_HIDDEN,
  RECOVERED_NOTICE_ENDED,
  refusesCalls,
  SESSION_EXPIRED,
  WENT_OFFLINE,
} from '@crook/web/rpc/HubLinkState'
import type { LinkCommand } from '@crook/web/rpc/HubLinkState'

const EVERY_EVENT = [
  ATTEMPT_BEGAN,
  NOTICE_DELAY_PASSED,
  HERD_RECEIVED,
  RECOVERED_NOTICE_ENDED,
  CONNECTION_DROPPED,
  DIAL_REFUSED,
  SESSION_EXPIRED,
  WENT_OFFLINE,
  PAGE_HIDDEN,
  LOGGED_OUT_CONFIRMED,
]

const SAMPLE_HERD = Option.some(
  new HerdSnapshot({
    view: new HerdView({ machines: [], hubVersion: CrookVersion.make('1.0.0') }),
    syncedAt: DateTime.makeUnsafe(0),
  }),
)

const isQuiet = LinkStatus.isAnyOf(['ColdStart', 'Redialing', 'Parked'])
const isTimerEvent = LinkEvent.isAnyOf(['NoticeDelayPassed', 'RecoveredNoticeEnded'])
const isFailed = LinkStatus.isAnyOf(['Unreachable', 'Offline'])

const viewsOf = (status: LinkStatus) =>
  Arr.map([SAMPLE_HERD, Option.none()], (herd) =>
    connectionView(new HubLinkState({ status, herd })),
  )

const inEveryView = (
  status: LinkStatus,
  holds: (view: ReturnType<typeof connectionView>) => boolean,
): boolean => Arr.every(viewsOf(status), holds)

export const linkWalk: WalkSpec<LinkStatus, LinkEvent, LinkCommand> = {
  machine: linkMachine,
  events: () => EVERY_EVENT,
  home: LinkStatus.guards.Live,
  terminal: LinkStatus.guards.LoggedOut,
  commandName: (command) => command,
  invariants: [
    {
      name: 'what dims says why',
      holds: (status) =>
        inEveryView(status, (view) => !dimsContent(view) || Option.isSome(noticeOf(view))),
    },
    {
      name: 'a quiet dial says nothing and dims nothing',
      holds: (status) =>
        !isQuiet(status) ||
        inEveryView(status, (view) => Option.isNone(noticeOf(view)) && !dimsContent(view)),
    },
    {
      name: 'open controls mean a call is held, never refused',
      holds: (status) =>
        inEveryView(status, (view) => allowsActions(view) === !refusesCalls(status)),
    },
    {
      name: 'a failure says when the herd was last synced, and only a failure does',
      holds: (status) =>
        isFailed(status) ===
        Option.isSome(syncedAtOf(connectionView(new HubLinkState({ status, herd: SAMPLE_HERD })))),
    },
  ],
  arrowRules: [
    {
      name: 'a dial that says nothing starts the timer that ends its silence',
      holds: ({ event, to, commands }) =>
        !LinkEvent.guards.AttemptBegan(event) ||
        !LinkStatus.isAnyOf(['ColdStart', 'Redialing'])(to) ||
        commands.includes('StartNoticeTimer'),
    },
    {
      name: 'recovering starts the timer that ends the notice',
      holds: ({ from, to, commands }) =>
        !LinkStatus.guards.Recovered(to) ||
        LinkStatus.guards.Recovered(from) ||
        commands.includes('StartRecoveredTimer'),
    },
    {
      name: 'a timer starts nothing further',
      holds: ({ event, commands }) => !isTimerEvent(event) || commands.length === 0,
    },
    {
      name: 'only a dial and the first herd start anything',
      holds: ({ event, commands }) =>
        commands.length === 0 || LinkEvent.isAnyOf(['AttemptBegan', 'HerdReceived'])(event),
    },
    {
      name: 'logging out is final',
      holds: ({ from, to }) =>
        !LinkStatus.guards.LoggedOut(from) ||
        caseName(LinkStatus, to) === caseName(LinkStatus, from),
    },
  ],
}
