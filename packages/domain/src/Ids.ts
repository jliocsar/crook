import * as Schema from 'effect/Schema'

export const MachineId = Schema.NonEmptyString.pipe(Schema.brand('MachineId'))
export type MachineId = typeof MachineId.Type

export const WorkspaceId = Schema.NonEmptyString.pipe(Schema.brand('WorkspaceId'))
export type WorkspaceId = typeof WorkspaceId.Type

export const TabId = Schema.NonEmptyString.pipe(Schema.brand('TabId'))
export type TabId = typeof TabId.Type

export const PaneId = Schema.NonEmptyString.pipe(Schema.brand('PaneId'))
export type PaneId = typeof PaneId.Type

export const GlobalPaneId = Schema.NonEmptyString.check(Schema.isIncluding('/')).pipe(
  Schema.brand('GlobalPaneId'),
)
export type GlobalPaneId = typeof GlobalPaneId.Type

export const ClaudeSessionId = Schema.NonEmptyString.pipe(Schema.brand('ClaudeSessionId'))
export type ClaudeSessionId = typeof ClaudeSessionId.Type

export const IdempotencyKey = Schema.NonEmptyString.pipe(Schema.brand('IdempotencyKey'))
export type IdempotencyKey = typeof IdempotencyKey.Type

export const TranscriptOffset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand('TranscriptOffset'),
)
export type TranscriptOffset = typeof TranscriptOffset.Type

export const toGlobalPaneId = (machine: MachineId, pane: PaneId): GlobalPaneId =>
  GlobalPaneId.make(`${machine}/${pane}`)
