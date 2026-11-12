import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Schema from 'effect/Schema'

import { MachineId, PaneId } from '@crook/domain/Ids'

export interface AgentOpened {
  readonly machine: MachineId
  readonly pane: PaneId
  readonly at: DateTime.Utc
  readonly listed: Option.Option<readonly PaneId[]>
}

export const OpenedTimes = Schema.Record(
  MachineId,
  Schema.Record(PaneId, Schema.DateTimeUtcFromString),
)
export type OpenedTimes = typeof OpenedTimes.Type

export const withOpened = (times: OpenedTimes, opened: AgentOpened): OpenedTimes => {
  const kept = pipe(
    Record.get(times, opened.machine),
    Option.getOrElse(() => ({})),
    (panes) =>
      Option.match(opened.listed, {
        onNone: () => panes,
        onSome: (listed) => Record.filter(panes, (_openedAt, pane) => Arr.contains(listed, pane)),
      }),
  )

  return Record.set(times, opened.machine, Record.set(kept, opened.pane, opened.at))
}
