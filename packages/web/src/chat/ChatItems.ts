import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as Equal from 'effect/Equal'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { relativeToFolder } from '@crook/domain/Ask'
import type { ClaudeSessionId, SubagentId } from '@crook/domain/Ids'
import { type Subagent, type SubagentStatus, statusOfNotice } from '@crook/domain/Subagent'
import type {
  AssistantMessage,
  CompactTrigger,
  ImageBlock,
  SystemMessage,
  ToolResultBlock,
  ToolUseBlock,
  UserMessage,
} from '@crook/domain/TranscriptMessage'
import { imagesIn, textsIn } from '@crook/web/chat/Blocks'
import { NO_ROSTERS, type SessionRosters, TranscriptLine } from '@crook/web/chat/TranscriptState'
import type { AgentRunStatus } from '@crook/web/components/ui/subagent-tree'
import type { ToolCallStatus } from '@crook/web/components/ui/tool-call'
import { LINE_BREAK, PARAGRAPH_BREAK } from '@crook/web/text/Lines'

type ToolStatus = ToolCallStatus

type RunStatus = AgentRunStatus

export type AgentActivity = 'working' | 'blocked' | 'still'

export type PlanStep = typeof PlanStep.Type

export type ChatItem = Data.TaggedEnum<{
  UserPrompt: {
    readonly key: string
    readonly text: string
    readonly images: readonly ImageBlock[]
    readonly queued: boolean
  }
  AssistantText: { readonly key: string; readonly text: string; readonly failed: boolean }
  Tool: { readonly key: string; readonly call: ToolCallModel }
  Subagents: { readonly key: string; readonly runs: readonly SubagentRun[] }
  Plan: { readonly key: string; readonly steps: readonly PlanStep[] }
  Note: { readonly key: string; readonly text: string }
  Compacted: {
    readonly key: string
    readonly trigger: Option.Option<CompactTrigger>
    readonly summary: Option.Option<string>
  }
  Cleared: { readonly key: string }
  Omitted: { readonly key: string; readonly byteLength: number }
  Unreadable: { readonly key: string; readonly byteLength: number }
}>

export interface ChatContext {
  readonly cwd: string
  readonly activity: AgentActivity
  readonly rosters: SessionRosters
}

interface Stamped<Value> {
  readonly value: Value
  readonly at: Option.Option<DateTime.Utc>
}

interface Placement {
  readonly turn: number
  readonly boundary: Option.Option<string>
}

interface Placed extends Placement {
  readonly line: TranscriptLine
}

type Call = Data.TaggedEnum.Value<Pending, 'Call'>

type Pending = Data.TaggedEnum<{
  Shown: { readonly item: ChatItem }
  Call: {
    readonly session: ClaudeSessionId
    readonly use: ToolUseBlock
    readonly key: string
    readonly at: Option.Option<DateTime.Utc>
    readonly turn: number
  }
}>

interface Draft {
  readonly pending: Pending
  readonly group: Option.Option<string>
}

interface Slot {
  readonly members: Arr.NonEmptyReadonlyArray<Pending>
}

interface Placing {
  readonly next: number
  readonly groups: HashMap.HashMap<string, number>
}

interface Target {
  readonly index: number
  readonly opens: boolean
  readonly pending: Pending
}

type Stamps<Value> = HashMap.HashMap<string, Stamped<Value>>

interface Evidence {
  readonly results: Stamps<ToolResultBlock>
  readonly notices: Stamps<string>
  readonly lastTurn: number
  readonly currentSession: Option.Option<ClaudeSessionId>
  readonly context: ChatContext
}

export interface ChatDerivation {
  readonly lines: readonly TranscriptLine[]
  readonly context: ChatContext
  readonly items: readonly ChatItem[]
  readonly slots: readonly Slot[]
  readonly placement: Placement
  readonly results: Stamps<ToolResultBlock>
  readonly notices: Stamps<string>
  readonly groups: HashMap.HashMap<string, number>
  readonly slotsOfCall: HashMap.HashMap<string, HashSet.HashSet<number>>
  readonly lastTurnSlots: HashSet.HashSet<number>
  readonly agentSlots: HashSet.HashSet<number>
}

const ASYNC_LAUNCH_STATUS = 'async_launched'
const INTERRUPTED_NOTE = 'Interrupted'
const PATH_FIELDS = new Set(['file_path', 'notebook_path', 'path'])
const AGENT_TOOL = 'Agent'
const PLAN_TOOL = 'TodoWrite'

const SUMMARY_FIELD = new Map([
  ['Bash', 'command'],
  ['Read', 'file_path'],
  ['Edit', 'file_path'],
  ['MultiEdit', 'file_path'],
  ['Write', 'file_path'],
  ['NotebookEdit', 'notebook_path'],
  ['Grep', 'pattern'],
  ['Glob', 'pattern'],
  ['WebFetch', 'url'],
  ['WebSearch', 'query'],
  ['Agent', 'description'],
  ['Skill', 'skill'],
  ['ToolSearch', 'query'],
])

export const ChatItem = Data.taggedEnum<ChatItem>()

const Pending = Data.taggedEnum<Pending>()

export class ToolCallModel extends Data.Class<{
  readonly id: string
  readonly name: string
  readonly summary: Option.Option<string>
  readonly input: Schema.Json
  readonly status: ToolStatus
  readonly result: Option.Option<ToolResultBlock>
  readonly startedAt: Option.Option<DateTime.Utc>
  readonly finishedAt: Option.Option<DateTime.Utc>
}> {}

export class SubagentRun extends Data.Class<{
  readonly toolUseId: string
  readonly session: ClaudeSessionId
  readonly subagent: Option.Option<SubagentId>
  readonly description: string
  readonly agentType: string
  readonly model: Option.Option<string>
  readonly prompt: string
  readonly background: boolean
  readonly status: RunStatus
  readonly sessionIdle: boolean
  readonly startedAt: Option.Option<DateTime.Utc>
  readonly finishedAt: Option.Option<DateTime.Utc>
}> {}

export const PlanStep = Schema.Struct({
  content: Schema.String,
  status: Schema.Literals(['pending', 'in_progress', 'completed']),
})

const PlanInput = Schema.Struct({ todos: Schema.Array(PlanStep) })

const AgentInput = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  prompt: Schema.optionalKey(Schema.String),
  subagent_type: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  run_in_background: Schema.optionalKey(Schema.Boolean),
})

const InputFields = Schema.Record(Schema.String, Schema.Unknown)

const decodePlan = Schema.decodeUnknownOption(PlanInput)
const decodeAgentInput = Schema.decodeUnknownOption(AgentInput)
const decodeFields = Schema.decodeUnknownOption(InputFields)
const decodeString = Schema.decodeUnknownOption(Schema.NonEmptyString)

const firstLine = (text: string): string =>
  pipe(
    text.trim().split(LINE_BREAK),
    Arr.head,
    Option.getOrElse(() => ''),
  )

export const stringField = (input: Schema.Json, field: string): Option.Option<string> =>
  pipe(
    decodeFields(input),
    Option.flatMap((fields) => decodeString(fields[field])),
  )

const firstStringField = (input: Schema.Json): Option.Option<readonly [string, string]> =>
  pipe(
    decodeFields(input),
    Option.flatMap((fields) =>
      Arr.findFirst(Object.entries(fields), ([field, value]) =>
        Option.map(decodeString(value), (text): readonly [string, string] => [field, text]),
      ),
    ),
  )

const summaryEntry = (name: string, input: Schema.Json): Option.Option<readonly [string, string]> =>
  pipe(
    Option.fromUndefinedOr(SUMMARY_FIELD.get(name)),
    Option.flatMap((field) =>
      Option.map(stringField(input, field), (value): readonly [string, string] => [field, value]),
    ),
    Option.orElse(() => firstStringField(input)),
  )

export const toolSummary = (name: string, input: Schema.Json, cwd: string): Option.Option<string> =>
  pipe(
    summaryEntry(name, input),
    Option.map(([field, value]) =>
      PATH_FIELDS.has(field) ? relativeToFolder(cwd, value) : firstLine(value),
    ),
    Option.filter(Str.isNonEmpty),
  )

export const toolTitle = (call: Pick<ToolCallModel, 'name' | 'summary'>): string =>
  Option.match(call.summary, {
    onNone: () => call.name,
    onSome: (summary) => `${call.name}(${summary})`,
  })

const isHumanPrompt = (message: UserMessage): boolean =>
  !message.isMeta &&
  !message.queued &&
  message.blocks.some((block) =>
    Match.value(block).pipe(
      Match.tags({ Text: () => true, Image: () => true }),
      Match.orElse(() => false),
    ),
  )

const startsTurn = (line: TranscriptLine): boolean =>
  TranscriptLine.$match(line, {
    SessionCleared: () => true,
    Message: ({ message }) =>
      Match.value(message).pipe(
        Match.tag('User', isHumanPrompt),
        Match.orElse(() => false),
      ),
  })

const keyOf = (line: TranscriptLine, index: number): string =>
  TranscriptLine.$match(line, {
    SessionCleared: ({ session }) => `${session} cleared`,
    Message: ({ session, message }) => `${session} ${message.offset} ${index}`,
  })

const boundaryOf = (line: TranscriptLine): Option.Option<string> =>
  TranscriptLine.$match(line, {
    SessionCleared: () => Option.none(),
    Message: ({ session, message }) =>
      Match.value(message).pipe(
        Match.tag('System', (system) =>
          Option.liftPredicate(`compact ${session} ${message.offset}`, () =>
            system.blocks.some((block) =>
              Match.value(block).pipe(
                Match.tag('CompactBoundary', () => true),
                Match.orElse(() => false),
              ),
            ),
          ),
        ),
        Match.orElse(() => Option.none<string>()),
      ),
  })

const place = (lines: readonly TranscriptLine[], from: Placement) =>
  Arr.mapAccum(lines, from, (state, line): readonly [Placement, Placed] => {
    const turn = startsTurn(line) ? state.turn + 1 : state.turn
    const boundary = Option.orElse(boundaryOf(line), () => state.boundary)

    return [
      { turn, boundary },
      { line, turn, boundary },
    ]
  })

const userMessageOf = (line: TranscriptLine): Option.Option<UserMessage> =>
  TranscriptLine.$match(line, {
    SessionCleared: () => Option.none(),
    Message: ({ message }) =>
      Match.value(message).pipe(
        Match.tag('User', (user) => Option.some(user)),
        Match.orElse(() => Option.none<UserMessage>()),
      ),
  })

const stampedBlocks = <Value>(
  lines: readonly TranscriptLine[],
  pick: (block: UserMessage['blocks'][number]) => Option.Option<readonly [string, Value]>,
): readonly (readonly [string, Stamped<Value>])[] =>
  pipe(
    lines,
    Arr.flatMap((line) => Option.toArray(userMessageOf(line))),
    Arr.flatMap((user) =>
      Arr.flatMap(user.blocks, (block) =>
        pipe(
          pick(block),
          Option.map(([id, value]): readonly [string, Stamped<Value>] => [
            id,
            { value, at: user.timestamp },
          ]),
          Option.toArray,
        ),
      ),
    ),
  )

const resultsIn = (lines: readonly TranscriptLine[]) =>
  stampedBlocks(lines, (block) =>
    Match.value(block).pipe(
      Match.tag('ToolResult', (result) =>
        Option.some<readonly [string, ToolResultBlock]>([result.toolUseId, result]),
      ),
      Match.orElse(() => Option.none()),
    ),
  )

const noticesIn = (lines: readonly TranscriptLine[]) =>
  stampedBlocks(lines, (block) =>
    Match.value(block).pipe(
      Match.tag('TaskNotification', (notice) =>
        Option.map(
          Option.all({ toolUseId: notice.toolUseId, status: notice.status }),
          ({ toolUseId, status }): readonly [string, string] => [toolUseId, status],
        ),
      ),
      Match.orElse(() => Option.none()),
    ),
  )

const draft = (item: ChatItem): Draft => ({
  pending: Pending.Shown({ item }),
  group: Option.none(),
})

const grouped = (item: ChatItem, group: string): Draft => ({
  pending: Pending.Shown({ item }),
  group: Option.some(group),
})

const outputNote = (text: string, key: string): readonly Draft[] =>
  Str.isNonEmpty(text.trim()) ? [draft(ChatItem.Note({ key, text: text.trim() }))] : []

const turnOver = (turn: number, evidence: Evidence): boolean =>
  turn < evidence.lastTurn || evidence.context.activity === 'still'

const toolStatus = (
  result: Option.Option<ToolResultBlock>,
  turn: number,
  evidence: Evidence,
): ToolStatus =>
  Option.match(result, {
    onSome: (found): ToolStatus => (found.isError ? 'error' : 'success'),
    onNone: (): ToolStatus => {
      if (turnOver(turn, evidence)) {
        return 'stopped'
      }

      return evidence.context.activity === 'blocked' ? 'waiting' : 'running'
    },
  })

const stampedValue = <Value>(stamped: Option.Option<Stamped<Value>>): Option.Option<Value> =>
  Option.map(stamped, (found) => found.value)

const stampedAt = <Value>(stamped: Option.Option<Stamped<Value>>): Option.Option<DateTime.Utc> =>
  Option.flatMap(stamped, (found) => found.at)

const rosterVerdict = (status: SubagentStatus): Option.Option<RunStatus> =>
  Match.value(status).pipe(
    Match.when('running', () => Option.none<RunStatus>()),
    Match.when('completed', () => Option.some<RunStatus>('done')),
    Match.whenOr('failed', 'stopped', () => Option.some<RunStatus>('failed')),
    Match.exhaustive,
  )

const runStatus = (options: {
  readonly notice: Option.Option<string>
  readonly roster: Option.Option<Subagent>
  readonly result: Option.Option<ToolResultBlock>
  readonly background: boolean
  readonly turnOver: boolean
}): RunStatus =>
  pipe(
    Option.firstSomeOf([
      Option.flatMap(options.roster, (subagent) => rosterVerdict(subagent.status)),
      Option.flatMap(options.notice, (status) => rosterVerdict(statusOfNotice(status))),
      pipe(
        options.result,
        Option.filter((result) => result.isError),
        Option.map((): RunStatus => 'failed'),
      ),
      pipe(
        options.result,
        Option.filter(() => !options.background),
        Option.map((): RunStatus => 'done'),
      ),
    ]),
    Option.getOrElse((): RunStatus =>
      !options.background && options.turnOver ? 'failed' : 'running',
    ),
  )

const subagentRun = (
  session: ClaudeSessionId,
  use: ToolUseBlock,
  at: Option.Option<DateTime.Utc>,
  turn: number,
  evidence: Evidence,
): SubagentRun => {
  const input = decodeAgentInput(use.input)
  const stampedResult = HashMap.get(evidence.results, use.id)
  const result = stampedValue(stampedResult)
  const roster = pipe(
    HashMap.get(evidence.context.rosters, session),
    Option.flatMap((subagents) =>
      Arr.findFirst(subagents, (subagent) => Option.contains(subagent.toolUseId, use.id)),
    ),
  )
  const launch = Option.flatMap(result, (found) => found.subagent)
  const notice = HashMap.get(evidence.notices, use.id)
  const background =
    Option.exists(input, (found) => found.run_in_background === true) ||
    Option.exists(roster, (subagent) => subagent.background) ||
    Option.exists(launch, (found) => found.status === ASYNC_LAUNCH_STATUS)
  const status = runStatus({
    notice: stampedValue(notice),
    roster,
    result,
    background,
    turnOver: turnOver(turn, evidence),
  })

  return new SubagentRun({
    toolUseId: use.id,
    session,
    subagent: Option.orElse(
      Option.map(launch, (found) => found.subagent),
      () => Option.map(roster, (subagent) => subagent.id),
    ),
    description: pipe(
      Option.flatMap(input, (found) => Option.fromUndefinedOr(found.description)),
      Option.orElse(() => Option.map(roster, (subagent) => subagent.description)),
      Option.getOrElse(() => AGENT_TOOL),
    ),
    agentType: pipe(
      Option.flatMap(input, (found) => Option.fromUndefinedOr(found.subagent_type)),
      Option.orElse(() => Option.map(roster, (subagent) => subagent.agentType)),
      Option.getOrElse(() => ''),
    ),
    model: Option.orElse(
      Option.flatMap(roster, (subagent) => subagent.model),
      () => Option.flatMap(input, (found) => Option.fromUndefinedOr(found.model)),
    ),
    prompt: pipe(
      Option.flatMap(input, (found) => Option.fromUndefinedOr(found.prompt)),
      Option.getOrElse(() => ''),
    ),
    background,
    status,
    sessionIdle:
      evidence.context.activity === 'still' || !Option.contains(evidence.currentSession, session),
    startedAt: at,
    finishedAt:
      status === 'running'
        ? Option.none()
        : Option.orElse(stampedAt(notice), () =>
            background ? Option.none() : stampedAt(stampedResult),
          ),
  })
}

const callItem = (call: Call, evidence: Evidence): ChatItem => {
  if (call.use.name === AGENT_TOOL) {
    return ChatItem.Subagents({
      key: call.key,
      runs: [subagentRun(call.session, call.use, call.at, call.turn, evidence)],
    })
  }

  const stamped = HashMap.get(evidence.results, call.use.id)
  const result = stampedValue(stamped)

  return ChatItem.Tool({
    key: call.key,
    call: new ToolCallModel({
      id: call.use.id,
      name: call.use.name,
      summary: toolSummary(call.use.name, call.use.input, evidence.context.cwd),
      input: call.use.input,
      status: toolStatus(result, call.turn, evidence),
      result,
      startedAt: call.at,
      finishedAt: stampedAt(stamped),
    }),
  })
}

const toolDraft = (
  session: ClaudeSessionId,
  use: ToolUseBlock,
  key: string,
  at: Option.Option<DateTime.Utc>,
  turn: number,
): Draft => {
  const call = Pending.Call({ session, use, key, at, turn })

  if (use.name === AGENT_TOOL) {
    return { pending: call, group: Option.some(`subagents ${turn}`) }
  }

  const plan = decodePlan(use.input)

  if (use.name === PLAN_TOOL && Option.isSome(plan)) {
    return grouped(ChatItem.Plan({ key, steps: plan.value.todos }), `plan ${turn}`)
  }

  return { pending: call, group: Option.none() }
}

const assistantDrafts = (
  session: ClaudeSessionId,
  message: AssistantMessage,
  keyAt: (index: number) => string,
  turn: number,
): readonly Draft[] =>
  Arr.flatMap(message.blocks, (block, index) =>
    Match.value(block).pipe(
      Match.tagsExhaustive({
        Text: (text) =>
          Str.isNonEmpty(text.text.trim())
            ? [
                draft(
                  ChatItem.AssistantText({
                    key: keyAt(index),
                    text: text.text,
                    failed: message.isApiError,
                  }),
                ),
              ]
            : [],
        Thinking: () => [],
        ToolUse: (use) => [toolDraft(session, use, keyAt(index), message.timestamp, turn)],
        Unrecognized: () => [],
      }),
    ),
  )

const promptDraft = (message: UserMessage, key: string): readonly Draft[] => {
  const text = Arr.join(textsIn(message.blocks), PARAGRAPH_BREAK).trim()
  const images = imagesIn(message.blocks)

  return Str.isEmpty(text) && images.length === 0
    ? []
    : [draft(ChatItem.UserPrompt({ key, text, images, queued: message.queued }))]
}

const userNoteDrafts = (
  message: UserMessage,
  keyAt: (index: number) => string,
  boundary: Option.Option<string>,
): readonly Draft[] =>
  Arr.flatMap(message.blocks, (block, index) =>
    Match.value(block).pipe(
      Match.tagsExhaustive({
        Text: () => [],
        Image: () => [],
        ToolResult: () => [],
        TaskNotification: () => [],
        Unrecognized: () => [],
        CompactSummary: (summary) => [
          grouped(
            ChatItem.Compacted({
              key: keyAt(index),
              trigger: Option.none(),
              summary: Option.some(summary.text),
            }),
            Option.getOrElse(boundary, () => keyAt(index)),
          ),
        ],
        LocalCommand: (command) => [
          draft(
            ChatItem.Note({ key: keyAt(index), text: `${command.name} ${command.args}`.trim() }),
          ),
        ],
        LocalCommandOutput: (output) => outputNote(output.text, keyAt(index)),
        Interruption: () => [draft(ChatItem.Note({ key: keyAt(index), text: INTERRUPTED_NOTE }))],
      }),
    ),
  )

const userDrafts = (
  message: UserMessage,
  keyAt: (index: number) => string,
  boundary: Option.Option<string>,
): readonly Draft[] =>
  message.isMeta
    ? []
    : [...promptDraft(message, keyAt(-1)), ...userNoteDrafts(message, keyAt, boundary)]

const systemDrafts = (
  message: SystemMessage,
  keyAt: (index: number) => string,
  boundary: Option.Option<string>,
): readonly Draft[] =>
  Arr.flatMap(message.blocks, (block, index) =>
    Match.value(block).pipe(
      Match.tagsExhaustive({
        CompactBoundary: (compact) => [
          grouped(
            ChatItem.Compacted({
              key: keyAt(index),
              trigger: compact.trigger,
              summary: Option.none(),
            }),
            Option.getOrElse(boundary, () => keyAt(index)),
          ),
        ],
        TurnDuration: () => [],
        LocalCommandOutput: (output) => outputNote(output.text, keyAt(index)),
        Notice: (notice) => [draft(ChatItem.Note({ key: keyAt(index), text: notice.text }))],
        Unrecognized: () => [],
      }),
    ),
  )

const draftsOf = (placed: Placed): readonly Draft[] => {
  const keyAt = (index: number) => keyOf(placed.line, index)

  return TranscriptLine.$match(placed.line, {
    SessionCleared: () => [draft(ChatItem.Cleared({ key: keyAt(0) }))],
    Message: ({ session, message }) =>
      Match.value(message).pipe(
        Match.tagsExhaustive({
          User: (user) => userDrafts(user, keyAt, placed.boundary),
          Assistant: (assistant) => assistantDrafts(session, assistant, keyAt, placed.turn),
          System: (system) => systemDrafts(system, keyAt, placed.boundary),
          UnrecognizedEntry: () => [],
          Malformed: (malformed) => [
            draft(ChatItem.Unreadable({ key: keyAt(0), byteLength: malformed.byteLength })),
          ],
          Omitted: (omitted) => [
            draft(ChatItem.Omitted({ key: keyAt(0), byteLength: omitted.byteLength })),
          ],
        }),
      ),
  })
}

const isSubagents = ChatItem.$is('Subagents')
const isPlan = ChatItem.$is('Plan')
const isCompacted = ChatItem.$is('Compacted')
const isTool = ChatItem.$is('Tool')

export const isUserPrompt = ChatItem.$is('UserPrompt')

const merge = (first: ChatItem, later: ChatItem): ChatItem => {
  if (isSubagents(first) && isSubagents(later)) {
    return ChatItem.Subagents({ key: first.key, runs: [...first.runs, ...later.runs] })
  }

  if (isPlan(first) && isPlan(later)) {
    return ChatItem.Plan({ key: first.key, steps: later.steps })
  }

  if (isCompacted(first) && isCompacted(later)) {
    return ChatItem.Compacted({
      key: first.key,
      trigger: Option.orElse(first.trigger, () => later.trigger),
      summary: Option.orElse(first.summary, () => later.summary),
    })
  }

  return first
}

const FIRST_PLACEMENT: Placement = { turn: 0, boundary: Option.none() }

const callOf = (pending: Pending): Option.Option<Call> =>
  Pending.$match(pending, {
    Shown: () => Option.none(),
    Call: (call) => Option.some(call),
  })

const isAgentCall = (pending: Pending): boolean =>
  Option.exists(callOf(pending), (call) => call.use.name === AGENT_TOOL)

const itemOf = (pending: Pending, evidence: Evidence): ChatItem =>
  Pending.$match(pending, {
    Shown: ({ item }) => item,
    Call: (call) => callItem(call, evidence),
  })

const slotItem = (slot: Slot, evidence: Evidence): ChatItem =>
  pipe(
    Arr.tailNonEmpty(slot.members),
    Arr.reduce(itemOf(Arr.headNonEmpty(slot.members), evidence), (item, member) =>
      merge(item, itemOf(member, evidence)),
    ),
  )

const withStamps = <Value>(
  stamps: Stamps<Value>,
  fresh: readonly (readonly [string, Stamped<Value>])[],
): Stamps<Value> => Arr.reduce(fresh, stamps, (all, [id, stamped]) => HashMap.set(all, id, stamped))

const targetOf = (placing: Placing, entry: Draft): readonly [Placing, Target] =>
  pipe(
    entry.group,
    Option.flatMap((group) => HashMap.get(placing.groups, group)),
    Option.match({
      onSome: (index): readonly [Placing, Target] => [
        placing,
        { index, opens: false, pending: entry.pending },
      ],
      onNone: (): readonly [Placing, Target] => [
        {
          next: placing.next + 1,
          groups: Option.match(entry.group, {
            onNone: () => placing.groups,
            onSome: (group) => HashMap.set(placing.groups, group, placing.next),
          }),
        },
        { index: placing.next, opens: true, pending: entry.pending },
      ],
    }),
  )

const joinedMembers = (
  joined: HashMap.HashMap<number, Arr.NonEmptyReadonlyArray<Pending>>,
  target: Target,
): HashMap.HashMap<number, Arr.NonEmptyReadonlyArray<Pending>> =>
  HashMap.set(
    joined,
    target.index,
    Option.match(HashMap.get(joined, target.index), {
      onNone: (): Arr.NonEmptyReadonlyArray<Pending> => [target.pending],
      onSome: (members) => Arr.append(members, target.pending),
    }),
  )

const indexesWhere = (
  targets: readonly Target[],
  keep: (pending: Pending) => boolean,
): HashSet.HashSet<number> =>
  HashSet.fromIterable(
    pipe(
      targets,
      Arr.filter((target) => keep(target.pending)),
      Arr.map((target) => target.index),
    ),
  )

const slotsOfCallAfter = (
  slotsOfCall: HashMap.HashMap<string, HashSet.HashSet<number>>,
  targets: readonly Target[],
): HashMap.HashMap<string, HashSet.HashSet<number>> =>
  Arr.reduce(targets, slotsOfCall, (all, target) =>
    Option.match(callOf(target.pending), {
      onNone: () => all,
      onSome: (call) =>
        HashMap.set(
          all,
          call.use.id,
          HashSet.add(
            Option.getOrElse(HashMap.get(all, call.use.id), () => HashSet.empty<number>()),
            target.index,
          ),
        ),
    }),
  )

const slotsOfIds = (
  slotsOfCall: HashMap.HashMap<string, HashSet.HashSet<number>>,
  ids: readonly string[],
): HashSet.HashSet<number> =>
  Arr.reduce(ids, HashSet.empty<number>(), (all, id) =>
    Option.match(HashMap.get(slotsOfCall, id), {
      onNone: () => all,
      onSome: (found) => HashSet.union(all, found),
    }),
  )

const sessionOf = (lines: readonly TranscriptLine[]): Option.Option<ClaudeSessionId> =>
  Option.map(Arr.last(lines), (line) => line.session)

const startOf = (context: ChatContext): ChatDerivation => ({
  lines: [],
  context,
  items: [],
  slots: [],
  placement: FIRST_PLACEMENT,
  results: HashMap.empty(),
  notices: HashMap.empty(),
  groups: HashMap.empty(),
  slotsOfCall: HashMap.empty(),
  lastTurnSlots: HashSet.empty(),
  agentSlots: HashSet.empty(),
})

const advance = (
  previous: ChatDerivation,
  lines: readonly TranscriptLine[],
  context: ChatContext,
): ChatDerivation => {
  const fresh = Arr.drop(lines, previous.lines.length)
  const [placement, placed] = place(fresh, previous.placement)
  const freshResults = resultsIn(fresh)
  const freshNotices = noticesIn(fresh)
  const drafts = Arr.flatMap(placed, (entry: Placed) => draftsOf(entry))
  const [placing, targets] = Arr.mapAccum(
    drafts,
    { next: previous.slots.length, groups: previous.groups },
    targetOf,
  )
  const joined = Arr.reduce(targets, HashMap.empty(), joinedMembers)
  const opened = pipe(
    targets,
    Arr.filter((target) => target.opens),
    Arr.flatMap((target) => Option.toArray(HashMap.get(joined, target.index))),
    Arr.map((members): Slot => ({ members })),
  )
  const slots = pipe(
    previous.slots,
    Arr.map((slot, index) =>
      Option.match(HashMap.get(joined, index), {
        onNone: () => slot,
        onSome: (members): Slot => ({ members: Arr.appendAll(slot.members, members) }),
      }),
    ),
    Arr.appendAll(opened),
  )
  const turnMoved = placement.turn !== previous.placement.turn
  const activityMoved = context.activity !== previous.context.activity
  const currentSession = Option.orElse(sessionOf(fresh), () => sessionOf(previous.lines))
  const slotsOfCall = slotsOfCallAfter(previous.slotsOfCall, targets)
  const lastTurnSlots = HashSet.union(
    turnMoved ? HashSet.empty<number>() : previous.lastTurnSlots,
    indexesWhere(targets, (pending) =>
      Option.exists(callOf(pending), (call) => call.turn === placement.turn),
    ),
  )
  const agentSlots = HashSet.union(previous.agentSlots, indexesWhere(targets, isAgentCall))
  const agentsMoved =
    activityMoved ||
    context.rosters !== previous.context.rosters ||
    !Equal.equals(currentSession, sessionOf(previous.lines))
  const dirty = pipe(
    HashSet.fromIterable(HashMap.keys(joined)),
    HashSet.union(
      slotsOfIds(slotsOfCall, [
        ...Arr.map(freshResults, ([id]) => id),
        ...Arr.map(freshNotices, ([id]) => id),
      ]),
    ),
    HashSet.union(turnMoved || activityMoved ? previous.lastTurnSlots : HashSet.empty()),
    HashSet.union(agentsMoved ? agentSlots : HashSet.empty()),
  )
  const results = withStamps(previous.results, freshResults)
  const notices = withStamps(previous.notices, freshNotices)
  const evidence: Evidence = {
    results,
    notices,
    lastTurn: placement.turn,
    currentSession,
    context,
  }

  return {
    lines,
    context,
    items: Arr.map(slots, (slot, index) =>
      HashSet.has(dirty, index)
        ? slotItem(slot, evidence)
        : Option.getOrElse(Arr.get(previous.items, index), () => slotItem(slot, evidence)),
    ),
    slots,
    placement,
    results,
    notices,
    groups: placing.groups,
    slotsOfCall,
    lastTurnSlots,
    agentSlots,
  }
}

const extendsLines = (previous: ChatDerivation, lines: readonly TranscriptLine[]): boolean => {
  const last = previous.lines.length - 1

  return (
    lines.length > last &&
    (last < 0 || (lines[0] === previous.lines[0] && lines[last] === previous.lines[last]))
  )
}

const sameContext = (previous: ChatContext, next: ChatContext): boolean =>
  previous.cwd === next.cwd &&
  previous.activity === next.activity &&
  previous.rosters === next.rosters

export const EMPTY_CHAT = startOf({ cwd: '', activity: 'still', rosters: NO_ROSTERS })

export const deriveChat = (
  previous: ChatDerivation,
  lines: readonly TranscriptLine[],
  context: ChatContext,
): ChatDerivation => {
  if (!extendsLines(previous, lines) || previous.context.cwd !== context.cwd) {
    return advance(startOf(context), lines, context)
  }

  return lines.length === previous.lines.length && sameContext(previous.context, context)
    ? previous
    : advance(previous, lines, context)
}

export const chatItems = (
  lines: readonly TranscriptLine[],
  context: ChatContext,
): readonly ChatItem[] => advance(startOf(context), lines, context).items

export const runsIn = (items: readonly ChatItem[]): readonly SubagentRun[] =>
  Arr.flatMap(items, (item) => (isSubagents(item) ? item.runs : []))

const isRunning = (run: SubagentRun): boolean => run.status === 'running'

export const runningCount = (items: readonly ChatItem[]): number =>
  Arr.filter(runsIn(items), isRunning).length

export const hasToolRunning = (items: readonly ChatItem[]): boolean =>
  Option.exists(
    Arr.last(items),
    (item) =>
      (isTool(item) && item.call.status === 'running') ||
      (isSubagents(item) && item.runs.some((run) => !run.background && isRunning(run))),
  )

export const firstRunningTreeKey = (items: readonly ChatItem[]): Option.Option<string> =>
  pipe(
    Arr.findFirst(items, (item) => isSubagents(item) && item.runs.some(isRunning)),
    Option.map((item) => item.key),
  )
