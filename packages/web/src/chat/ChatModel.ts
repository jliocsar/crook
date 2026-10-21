import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

import { agentTitleOrPane } from '@crook/domain/AgentRow'
import type { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { findMachine } from '@crook/domain/HerdView'
import type { HerdMachine } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { panePresence } from '@crook/domain/MachineState'
import type { HerdSnapshot } from '@crook/web/cache/HerdCache'
import type { AgentActivity } from '@crook/web/chat/ChatItems'
import { findAgent } from '@crook/web/herd/HerdLayout'

export type ChatPresence = 'loading' | 'live' | 'away' | 'exited' | 'closed' | 'notClaude'

export type EdgeKind = Extract<ChatPresence, 'away' | 'exited' | 'closed'>

export type ChatStatus = Data.TaggedEnum<{
  Agent: { readonly status: AgentStatus }
  Ended: { readonly label: string }
  Quiet: Record<never, never>
}>

export const ChatStatus = Data.taggedEnum<ChatStatus>()

export class ChatScreenModel extends Data.Class<{
  readonly presence: ChatPresence
  readonly machine: Option.Option<HerdMachine>
  readonly row: Option.Option<AgentRow>
  readonly endedAt: Option.Option<DateTime.Utc>
}> {}

export const LOADING_CHAT = new ChatScreenModel({
  presence: 'loading',
  machine: Option.none(),
  row: Option.none(),
  endedAt: Option.none(),
})

const ended = (presence: ChatPresence): boolean => presence === 'exited' || presence === 'closed'

const endedPresence = (seenBefore: boolean, gone: boolean, stale: boolean): ChatPresence => {
  if (!seenBefore && !gone) {
    return 'notClaude'
  }

  if (!seenBefore && stale) {
    return 'loading'
  }

  return gone ? 'closed' : 'exited'
}

const presenceIn = (
  entry: HerdMachine,
  pane: PaneId,
  previous: ChatScreenModel,
  stale: boolean,
): ChatPresence => {
  if (entry.machine.connection !== 'online') {
    return 'away'
  }

  return Option.match(entry.state, {
    onNone: (): ChatPresence => 'loading',
    onSome: (state) => {
      const found = panePresence(state, pane)

      return found === 'agent'
        ? 'live'
        : endedPresence(Option.isSome(previous.row), found === 'gone', stale)
    },
  })
}

export const chatScreenModel = (
  snapshot: Option.Option<HerdSnapshot>,
  machine: MachineId,
  pane: PaneId,
  previous: ChatScreenModel,
  stale: boolean,
): ChatScreenModel =>
  Option.match(snapshot, {
    onNone: () => previous,
    onSome: ({ view, syncedAt }) => {
      const entry = findMachine(view, machine)
      const presence = Option.match(entry, {
        onNone: () => endedPresence(Option.isSome(previous.row), true, stale),
        onSome: (found) => presenceIn(found, pane, previous, stale),
      })
      const row = Option.orElse(
        Option.map(findAgent(view, machine, pane), (found) => found.row),
        () => previous.row,
      )

      return new ChatScreenModel({
        presence,
        machine: Option.orElse(entry, () => previous.machine),
        row,
        endedAt: ended(presence)
          ? Option.orElse(
              Option.filter(previous.endedAt, () => previous.presence === presence),
              () => Option.some(syncedAt),
            )
          : Option.none(),
      })
    },
  })

export const machineLabelOf = (model: ChatScreenModel): string =>
  Option.match(model.machine, {
    onNone: () => 'The machine',
    onSome: (entry) => entry.machine.label,
  })

export const chatStatus = (model: ChatScreenModel): ChatStatus => {
  if (model.presence === 'away') {
    return ChatStatus.Ended({ label: `${machineLabelOf(model)} offline` })
  }

  if (ended(model.presence)) {
    return ChatStatus.Ended({ label: model.presence })
  }

  return Option.match(model.row, {
    onNone: () => ChatStatus.Quiet(),
    onSome: (row) => ChatStatus.Agent({ status: row.status }),
  })
}

export const STATUS_WORD = {
  idle: 'idle',
  working: 'working',
  blocked: 'needs you',
  done: 'done',
  unknown: 'unknown',
} satisfies Record<AgentStatus, string>

export const activityOf = (model: ChatScreenModel): AgentActivity => {
  if (model.presence !== 'live' && model.presence !== 'away') {
    return 'still'
  }

  return Option.match(model.row, {
    onNone: (): AgentActivity => 'still',
    onSome: (row): AgentActivity => {
      if (row.status === 'working') {
        return 'working'
      }

      return row.status === 'blocked' ? 'blocked' : 'still'
    },
  })
}

export const workspaceLabelOf = (model: ChatScreenModel): Option.Option<string> =>
  Option.flatMap(Option.all({ entry: model.machine, row: model.row }), ({ entry, row }) =>
    pipe(
      entry.state,
      Option.flatMap((state) =>
        Arr.findFirst(state.workspaces, (workspace) => workspace.id === row.workspace),
      ),
      Option.map((workspace) => workspace.label),
    ),
  )

export const cwdOf = (model: ChatScreenModel): string =>
  Option.match(model.row, { onNone: () => '', onSome: (row) => row.cwd })

export const titleOf = (model: ChatScreenModel, pane: PaneId): string =>
  Option.match(model.row, { onNone: () => pane, onSome: agentTitleOrPane })

const isEdge = (presence: ChatPresence): presence is EdgeKind =>
  presence === 'away' || ended(presence)

export const edgeKindOf = (model: ChatScreenModel): Option.Option<EdgeKind> =>
  Option.liftPredicate(model.presence, isEdge)

export const isWatching = (model: ChatScreenModel): boolean =>
  model.presence === 'live' || model.presence === 'loading'

export const placeOf = (model: ChatScreenModel): Option.Option<string> =>
  pipe(
    [Option.some(machineLabelOf(model)), workspaceLabelOf(model)],
    Arr.getSomes,
    Arr.join(' · '),
    Option.liftPredicate((text) => text !== ''),
    Option.filter(() => Option.isSome(model.machine)),
  )
