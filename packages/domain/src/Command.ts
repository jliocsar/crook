import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Hex from 'effect/encoding/Hex'
import * as Equivalence from 'effect/Equivalence'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { AbsolutePath } from '@crook/domain/AbsolutePath'
import { CrookVersion, isBehind } from '@crook/domain/CrookVersion'
import { AgentRow } from '@crook/domain/AgentRow'
import { AskId, PaneId } from '@crook/domain/Ids'

const WITHOUT_CONTROL_CHARACTERS = /^\P{Cc}*$/u
const WITHOUT_WHITESPACE_OR_CONTROL_CHARACTERS = /^[^\s\p{Cc}]+$/u
const INTERRUPT_KEY = 'esc'
const SHA256_HEX = /^[0-9a-f]{64}$/u
const ATTACHMENT_NAME_LIMIT = 255
const MEBIBYTE = 1024 * 1024
const SHA_256 = 'SHA-256'

export const ATTACHMENT_COUNT_LIMIT = 10
export const ATTACHMENT_BYTES_LIMIT = 25 * MEBIBYTE

export const PaneLabel = Schema.Trimmed.check(
  Schema.isNonEmpty(),
  Schema.isPattern(WITHOUT_CONTROL_CHARACTERS),
)

export const samePaneLabel = Option.makeEquivalence(Equivalence.String)

export const AttachmentDigest = Schema.String.check(Schema.isPattern(SHA256_HEX)).pipe(
  Schema.brand('AttachmentDigest'),
)
export type AttachmentDigest = typeof AttachmentDigest.Type

export const AttachmentName = Schema.Trimmed.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(ATTACHMENT_NAME_LIMIT),
  Schema.isPattern(WITHOUT_CONTROL_CHARACTERS),
)

export class AttachmentRef extends Schema.Class<AttachmentRef>('AttachmentRef')({
  name: AttachmentName,
  mediaType: Schema.String.check(Schema.isPattern(WITHOUT_CONTROL_CHARACTERS)),
  size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: ATTACHMENT_BYTES_LIMIT })),
  digest: AttachmentDigest,
}) {}

export const attachmentDigestOf = (bytes: Uint8Array<ArrayBuffer>) =>
  Effect.promise(() => crypto.subtle.digest(SHA_256, bytes)).pipe(
    Effect.map((digest) => AttachmentDigest.make(Hex.encode(new Uint8Array(digest)))),
  )

export const attachmentsOf = (command: Command): readonly AttachmentRef[] =>
  Match.value(command).pipe(
    Match.tag('Prompt', (prompt) => prompt.attachments),
    Match.orElse(() => []),
  )

export const FIRST_AGENT_WITH_ATTACHMENTS = CrookVersion.make('0.0.14')

export const takesAttachments = (agentVersion: Option.Option<CrookVersion>): boolean =>
  Option.exists(agentVersion, (version) => !isBehind(version, FIRST_AGENT_WITH_ATTACHMENTS))

export const attachmentBytes = (attachments: readonly AttachmentRef[]): number =>
  attachments.reduce((sum, attachment) => sum + attachment.size, 0)

const PromptFields = Schema.Struct({
  pane: PaneId,
  text: Schema.String,
  attachments: Schema.Array(AttachmentRef)
    .check(Schema.isMaxLength(ATTACHMENT_COUNT_LIMIT))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
}).check(
  Schema.makeFilter((prompt) => prompt.text.length > 0 || prompt.attachments.length > 0, {
    expected: 'a prompt with text or at least one attachment',
  }),
  Schema.makeFilter((prompt) => attachmentBytes(prompt.attachments) <= ATTACHMENT_BYTES_LIMIT, {
    expected: 'attachments that add up to at most 25 MiB',
  }),
)

export class Prompt extends Schema.TaggedClass<Prompt>()('Prompt', PromptFields) {}

export class SendKeys extends Schema.TaggedClass<SendKeys>()('SendKeys', {
  pane: PaneId,
  keys: Schema.NonEmptyArray(Schema.NonEmptyString),
}) {}

export class RenameAgent extends Schema.TaggedClass<RenameAgent>()('RenameAgent', {
  pane: PaneId,
  label: Schema.OptionFromNullOr(PaneLabel),
}) {}

export class ClosePane extends Schema.TaggedClass<ClosePane>()('ClosePane', {
  pane: PaneId,
  confirmed: Schema.Boolean,
}) {}

export class Approve extends Schema.TaggedClass<Approve>()('Approve', {}) {}

export class ApproveAlways extends Schema.TaggedClass<ApproveAlways>()('ApproveAlways', {}) {}

export class Decline extends Schema.TaggedClass<Decline>()('Decline', {
  message: Schema.OptionFromNullOr(Schema.NonEmptyString),
}) {}

export class Choose extends Schema.TaggedClass<Choose>()('Choose', {
  answer: Schema.NonEmptyString,
}) {}

export const AskAnswer = Schema.Union([Approve, ApproveAlways, Decline, Choose])
export type AskAnswer = typeof AskAnswer.Type

export class AnswerAsk extends Schema.TaggedClass<AnswerAsk>()('AnswerAsk', {
  pane: PaneId,
  ask: AskId,
  answer: AskAnswer,
}) {}

export const AgentKind = Schema.Literals(['claude'])
export type AgentKind = typeof AgentKind.Type

export const FolderPath = AbsolutePath.check(Schema.isPattern(WITHOUT_CONTROL_CHARACTERS))

export const WorktreeBranch = Schema.String.check(
  Schema.isPattern(WITHOUT_WHITESPACE_OR_CONTROL_CHARACTERS),
)

export class StartAgent extends Schema.TaggedClass<StartAgent>()('StartAgent', {
  kind: AgentKind,
  folder: FolderPath,
  task: Schema.OptionFromNullOr(Schema.NonEmptyString),
}) {}

export class CreateWorktree extends Schema.TaggedClass<CreateWorktree>()('CreateWorktree', {
  kind: AgentKind,
  folder: FolderPath,
  branch: WorktreeBranch,
  task: Schema.OptionFromNullOr(Schema.NonEmptyString),
}) {}

export const PaneCommand = Schema.Union([Prompt, SendKeys, RenameAgent, ClosePane, AnswerAsk])
export type PaneCommand = typeof PaneCommand.Type

export const LaunchCommand = Schema.Union([StartAgent, CreateWorktree])
export type LaunchCommand = typeof LaunchCommand.Type

export const Command = Schema.Union([...PaneCommand.members, ...LaunchCommand.members])
export type Command = typeof Command.Type

export class InputDelivered extends Schema.TaggedClass<InputDelivered>()('InputDelivered', {
  pane: PaneId,
  terminal: AgentRow.fields.terminal,
  stateChangeSeq: AgentRow.fields.stateChangeSeq,
}) {}

export class PaneRenamed extends Schema.TaggedClass<PaneRenamed>()('PaneRenamed', {
  pane: PaneId,
  label: AgentRow.fields.label,
}) {}

export class PaneClosed extends Schema.TaggedClass<PaneClosed>()('PaneClosed', {
  pane: PaneId,
}) {}

export class AgentStarted extends Schema.TaggedClass<AgentStarted>()('AgentStarted', {
  pane: PaneId,
}) {}

export const CommandReceipt = Schema.Union([InputDelivered, PaneRenamed, PaneClosed, AgentStarted])
export type CommandReceipt = typeof CommandReceipt.Type

export const interrupt = (pane: PaneId) => new SendKeys({ pane, keys: [INTERRUPT_KEY] })

export const targetPane = (command: PaneCommand): PaneId =>
  Match.value(command).pipe(
    Match.tagsExhaustive({
      Prompt: (prompt) => prompt.pane,
      SendKeys: (sendKeys) => sendKeys.pane,
      RenameAgent: (rename) => rename.pane,
      ClosePane: (close) => close.pane,
      AnswerAsk: (answer) => answer.pane,
    }),
  )

export const hasStarted = (receipt: AgentStarted, agents: readonly AgentRow[]) =>
  agents.some((row) => row.pane === receipt.pane)

export const hasRenamed = (receipt: PaneRenamed, row: AgentRow) =>
  row.pane === receipt.pane && samePaneLabel(receipt.label, row.label)

export const hasClosed = (receipt: PaneClosed, agents: readonly AgentRow[]) =>
  !agents.some((row) => row.pane === receipt.pane)

export const isReceiptShown = (receipt: CommandReceipt, agents: readonly AgentRow[]): boolean =>
  Match.value(receipt).pipe(
    Match.tagsExhaustive({
      InputDelivered: (delivered) =>
        Option.match(
          Arr.findFirst(agents, (row) => row.pane === delivered.pane),
          { onNone: () => true, onSome: (row) => hasMovedSince(delivered, row) },
        ),
      PaneRenamed: (renamed) => Arr.some(agents, (row) => hasRenamed(renamed, row)),
      PaneClosed: (closed) => hasClosed(closed, agents),
      AgentStarted: (started) => hasStarted(started, agents),
    }),
  )

export const hasMovedSince = (receipt: InputDelivered, row: AgentRow) =>
  row.pane === receipt.pane &&
  (row.terminal !== receipt.terminal || row.stateChangeSeq > receipt.stateChangeSeq)
