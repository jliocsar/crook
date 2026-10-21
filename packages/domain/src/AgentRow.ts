import * as Equivalence from 'effect/Equivalence'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { AgentStatus } from '@crook/domain/AgentStatus'
import { Ask, askSummary } from '@crook/domain/Ask'
import { ClaudeSessionId, PaneId, TabId, TerminalId, WorkspaceId } from '@crook/domain/Ids'

export type SeenMark = Pick<AgentRow, 'terminal' | 'stateChangeSeq'>

export const StateChangeSeq = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export class StatusBeforeHandoff extends Schema.Class<StatusBeforeHandoff>('StatusBeforeHandoff')({
  status: AgentStatus,
  statusChangedAt: Schema.DateTimeUtcFromString,
  terminal: TerminalId,
  stateChangeSeq: StateChangeSeq,
}) {}

export class AgentRow extends Schema.Class<AgentRow>('AgentRow')({
  pane: PaneId,
  workspace: WorkspaceId,
  tab: TabId,
  terminal: TerminalId,
  status: AgentStatus,
  title: Schema.String,
  label: Schema.OptionFromNullOr(Schema.String),
  createdByCrook: Schema.Boolean,
  cwd: Schema.String,
  branch: Schema.OptionFromNullOr(Schema.String),
  claudeSession: Schema.OptionFromNullOr(ClaudeSessionId),
  stateChangeSeq: StateChangeSeq,
  statusChangedAt: Schema.DateTimeUtcFromString,
  beforeHandoff: Schema.OptionFromNullOr(StatusBeforeHandoff),
  ask: Schema.OptionFromNullOr(Ask),
}) {}

export const seenMarkOf = (row: AgentRow): SeenMark =>
  Option.match(row.beforeHandoff, {
    onNone: () => ({ terminal: row.terminal, stateChangeSeq: row.stateChangeSeq }),
    onSome: (before) => ({ terminal: before.terminal, stateChangeSeq: before.stateChangeSeq }),
  })

export const isSameSeenMark: Equivalence.Equivalence<SeenMark> = Equivalence.Struct({
  terminal: Equivalence.String,
  stateChangeSeq: Equivalence.Number,
})

export const agentTitle = (row: AgentRow): string => Option.getOrElse(row.label, () => row.title)

export const agentTitleOrPane = (row: AgentRow): string =>
  pipe(
    agentTitle(row),
    Option.liftPredicate(Str.isNonEmpty),
    Option.getOrElse(() => row.pane),
  )

export const pendingAskSummary = (row: AgentRow): Option.Option<string> =>
  Option.flatMap(row.ask, (ask) => askSummary(ask, row.cwd))
