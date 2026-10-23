import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { relativeToFolder } from '@crook/domain/Ask'
import type { ClaudeSessionId, SubagentId } from '@crook/domain/Ids'
import type { Subagent } from '@crook/domain/Subagent'
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
import { TranscriptLine } from '@crook/web/chat/TranscriptState'
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
  readonly subagents: readonly Subagent[]
}

interface Stamped<Value> {
  readonly value: Value
  readonly at: Option.Option<DateTime.Utc>
}

interface Placed {
  readonly line: TranscriptLine
  readonly turn: number
  readonly boundary: Option.Option<string>
}

interface Draft {
  readonly item: ChatItem
  readonly group: Option.Option<string>
}

interface Evidence {
  readonly results: ReadonlyMap<string, Stamped<ToolResultBlock>>
  readonly notices: ReadonlyMap<string, Stamped<string>>
  readonly lastTurn: number
  readonly context: ChatContext
}

const ASYNC_LAUNCH_STATUS = 'async_launched'
const COMPLETED_STATUS = 'completed'
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

const place = (lines: readonly TranscriptLine[]) =>
  Arr.mapAccum(
    lines,
    { turn: 0, boundary: Option.none<string>() },
    (state, line): readonly [{ turn: number; boundary: Option.Option<string> }, Placed] => {
      const turn = startsTurn(line) ? state.turn + 1 : state.turn
      const boundary = Option.orElse(boundaryOf(line), () => state.boundary)

      return [
        { turn, boundary },
        { line, turn, boundary },
      ]
    },
  )

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
): ReadonlyMap<string, Stamped<Value>> =>
  new Map(
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

const draft = (item: ChatItem): Draft => ({ item, group: Option.none() })

const grouped = (item: ChatItem, group: string): Draft => ({ item, group: Option.some(group) })

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

const runStatus = (options: {
  readonly notice: Option.Option<string>
  readonly roster: Option.Option<Subagent>
  readonly result: Option.Option<ToolResultBlock>
  readonly background: boolean
  readonly turnOver: boolean
}): RunStatus =>
  pipe(
    Option.firstSomeOf([
      Option.map(options.notice, (status): RunStatus =>
        status === COMPLETED_STATUS ? 'done' : 'failed',
      ),
      pipe(
        options.roster,
        Option.filter((subagent) => subagent.stoppedByUser),
        Option.map((): RunStatus => 'failed'),
      ),
      pipe(
        options.roster,
        Option.filter((subagent) => subagent.finished),
        Option.map((): RunStatus => 'done'),
      ),
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
  const stampedResult = Option.fromUndefinedOr(evidence.results.get(use.id))
  const result = stampedValue(stampedResult)
  const roster = Arr.findFirst(evidence.context.subagents, (subagent) =>
    Option.contains(subagent.toolUseId, use.id),
  )
  const launch = Option.flatMap(result, (found) => found.subagent)
  const notice = Option.fromUndefinedOr(evidence.notices.get(use.id))
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
    startedAt: at,
    finishedAt:
      status === 'running'
        ? Option.none()
        : Option.orElse(stampedAt(notice), () =>
            background ? Option.none() : stampedAt(stampedResult),
          ),
  })
}

const toolDraft = (
  session: ClaudeSessionId,
  use: ToolUseBlock,
  key: string,
  at: Option.Option<DateTime.Utc>,
  turn: number,
  evidence: Evidence,
): Draft => {
  if (use.name === AGENT_TOOL) {
    return grouped(
      ChatItem.Subagents({ key, runs: [subagentRun(session, use, at, turn, evidence)] }),
      `subagents ${turn}`,
    )
  }

  const plan = decodePlan(use.input)

  if (use.name === PLAN_TOOL && Option.isSome(plan)) {
    return grouped(ChatItem.Plan({ key, steps: plan.value.todos }), `plan ${turn}`)
  }

  const stamped = Option.fromUndefinedOr(evidence.results.get(use.id))
  const result = stampedValue(stamped)

  return draft(
    ChatItem.Tool({
      key,
      call: new ToolCallModel({
        id: use.id,
        name: use.name,
        summary: toolSummary(use.name, use.input, evidence.context.cwd),
        input: use.input,
        status: toolStatus(result, turn, evidence),
        result,
        startedAt: at,
        finishedAt: stampedAt(stamped),
      }),
    }),
  )
}

const assistantDrafts = (
  session: ClaudeSessionId,
  message: AssistantMessage,
  keyAt: (index: number) => string,
  turn: number,
  evidence: Evidence,
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
        ToolUse: (use) => [
          toolDraft(session, use, keyAt(index), message.timestamp, turn, evidence),
        ],
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

const draftsOf = (placed: Placed, evidence: Evidence): readonly Draft[] => {
  const keyAt = (index: number) => keyOf(placed.line, index)

  return TranscriptLine.$match(placed.line, {
    SessionCleared: () => [draft(ChatItem.Cleared({ key: keyAt(0) }))],
    Message: ({ session, message }) =>
      Match.value(message).pipe(
        Match.tagsExhaustive({
          User: (user) => userDrafts(user, keyAt, placed.boundary),
          Assistant: (assistant) =>
            assistantDrafts(session, assistant, keyAt, placed.turn, evidence),
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

const groupDrafts = (drafts: readonly Draft[]): readonly ChatItem[] => {
  const groups = pipe(
    drafts,
    Arr.filter((entry) => Option.isSome(entry.group)),
    Arr.groupBy((entry) => Option.getOrElse(entry.group, () => '')),
  )

  return Arr.flatMap(drafts, (entry) =>
    Option.match(entry.group, {
      onNone: () => [entry.item],
      onSome: (group) =>
        pipe(
          Option.fromUndefinedOr(groups[group]),
          Option.filter((members) => members[0] === entry),
          Option.map((members) =>
            pipe(
              members,
              Arr.drop(1),
              Arr.reduce(entry.item, (item, member) => merge(item, member.item)),
            ),
          ),
          Option.toArray,
        ),
    }),
  )
}

export const chatItems = (
  lines: readonly TranscriptLine[],
  context: ChatContext,
): readonly ChatItem[] => {
  const [lastState, placed] = place(lines)
  const evidence: Evidence = {
    results: resultsIn(lines),
    notices: noticesIn(lines),
    lastTurn: lastState.turn,
    context,
  }

  return groupDrafts(Arr.flatMap(placed, (entry) => draftsOf(entry, evidence)))
}

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
