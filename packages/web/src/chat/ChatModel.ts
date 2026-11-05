import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'

import { agentTitleOrPane } from '@crook/domain/AgentRow'
import type { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { findMachine } from '@crook/domain/HerdView'
import type { HerdMachine } from '@crook/domain/HerdView'
import type { Machine } from '@crook/domain/Machine'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import type { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { activityView } from '@crook/web/chat/ActivityMachine'
import type { ActivityState } from '@crook/web/chat/ActivityMachine'
import { LOADING, PresenceState, showsComposer } from '@crook/web/chat/PresenceMachine'
import { findAgent } from '@crook/web/herd/HerdLayout'

export type EdgeKind = 'away' | 'exited' | 'closed'

export type ChatStatus = Data.TaggedEnum<{
  Agent: { readonly status: AgentStatus }
  Ended: { readonly label: string }
  Quiet: Record<never, never>
}>

export const ChatStatus = Data.taggedEnum<ChatStatus>()

export class ChatScreenModel extends Data.Class<{
  readonly presence: PresenceState
  readonly machine: Option.Option<Machine>
  readonly workspaceLabel: Option.Option<string>
  readonly row: Option.Option<AgentRow>
}> {}

export const LOADING_CHAT = new ChatScreenModel({
  presence: LOADING,
  machine: Option.none(),
  workspaceLabel: Option.none(),
  row: Option.none(),
})

const workspaceLabelIn = (entry: HerdMachine, row: AgentRow): Option.Option<string> =>
  pipe(
    entry.state,
    Option.flatMap((state) =>
      Arr.findFirst(state.workspaces, (workspace) => workspace.id === row.workspace),
    ),
    Option.map((workspace) => workspace.label),
  )

export const withPresence = (model: ChatScreenModel, presence: PresenceState): ChatScreenModel =>
  new ChatScreenModel(Struct.evolve(model, { presence: () => presence }))

export const chatScreenModel = (
  snapshot: Option.Option<HerdSnapshot>,
  machine: MachineId,
  pane: PaneId,
  previous: ChatScreenModel,
  presence: PresenceState,
): ChatScreenModel =>
  Option.match(snapshot, {
    onNone: () => withPresence(previous, presence),
    onSome: ({ view }) => {
      const entry = findMachine(view, machine)
      const row = Option.orElse(
        Option.map(findAgent(view, machine, pane), (found) => found.row),
        () => previous.row,
      )

      return new ChatScreenModel({
        presence,
        machine: Option.orElse(
          Option.map(entry, (found) => found.machine),
          () => previous.machine,
        ),
        workspaceLabel: Option.match(entry, {
          onNone: () => previous.workspaceLabel,
          onSome: (found) => Option.flatMap(row, (shown) => workspaceLabelIn(found, shown)),
        }),
        row,
      })
    },
  })

export const machineLabelOf = (model: ChatScreenModel): string =>
  Option.match(model.machine, {
    onNone: () => 'The machine',
    onSome: (machine) => machine.label,
  })

const agentStatus = (activity: ActivityState): ChatStatus =>
  Option.match(activityView(activity).status, {
    onNone: () => ChatStatus.Quiet(),
    onSome: (status) => ChatStatus.Agent({ status }),
  })

export const chatStatus = (model: ChatScreenModel, activity: ActivityState): ChatStatus =>
  PresenceState.match<ChatStatus>(model.presence, {
    Loading: () => agentStatus(activity),
    Live: () => agentStatus(activity),
    Redialing: () => agentStatus(activity),
    Reconnecting: () => ChatStatus.Ended({ label: `${machineLabelOf(model)} reconnecting` }),
    Away: () => ChatStatus.Ended({ label: `${machineLabelOf(model)} offline` }),
    Exited: () => ChatStatus.Ended({ label: 'exited' }),
    Closed: () => ChatStatus.Ended({ label: 'closed' }),
    NotClaude: () => agentStatus(activity),
  })

export const cwdOf = (model: ChatScreenModel): string =>
  Option.match(model.row, { onNone: () => '', onSome: (row) => row.cwd })

export const titleOf = (model: ChatScreenModel, pane: PaneId): string =>
  Option.match(model.row, { onNone: () => pane, onSome: agentTitleOrPane })

export const edgeKindOf = (model: ChatScreenModel): Option.Option<EdgeKind> =>
  PresenceState.match<Option.Option<EdgeKind>>(model.presence, {
    Loading: () => Option.none(),
    Live: () => Option.none(),
    Redialing: () => Option.none(),
    Reconnecting: () => Option.none(),
    Away: () => Option.some('away'),
    Exited: () => Option.some('exited'),
    Closed: () => Option.some('closed'),
    NotClaude: () => Option.none(),
  })

export const endedAtOf = (model: ChatScreenModel): Option.Option<DateTime.Utc> =>
  PresenceState.match<Option.Option<DateTime.Utc>>(model.presence, {
    Loading: () => Option.none(),
    Live: () => Option.none(),
    Redialing: () => Option.none(),
    Reconnecting: () => Option.none(),
    Away: () => Option.none(),
    Exited: ({ at }) => Option.some(at),
    Closed: ({ at }) => Option.some(at),
    NotClaude: () => Option.none(),
  })

export const isWatching = (model: ChatScreenModel): boolean => showsComposer(model.presence)

export const placeOf = (model: ChatScreenModel): Option.Option<string> =>
  Option.flatMap(model.machine, (machine) =>
    pipe(
      [Option.some(machine.label), model.workspaceLabel],
      Arr.getSomes,
      Arr.join(' · '),
      Option.liftPredicate((text) => text !== ''),
    ),
  )
