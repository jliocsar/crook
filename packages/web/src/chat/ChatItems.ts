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
  TranscriptMessage,
  UserMessage,
} from '@crook/domain/TranscriptMessage'
import { TranscriptLine } from '@crook/web/chat/TranscriptState'

export type ToolStatus = 'running' | 'waiting' | 'success' | 'error' | 'stopped'

export type RunStatus = 'running' | 'done' | 'failed'

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

export const AGENT_TOOL = 'Agent'
export const PLAN_TOOL = 'TodoWrite'

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

export const firstLine = (text: string): string =>
  pipe(
    text.trim().split('\n'),
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

const isBoundary = (line: TranscriptLine): boolean =>
  TranscriptLine.$match(line, {
    SessionCleared: () => false,
    Message: ({ message }) =>
      Match.value(message).pipe(
        Match.tag('System', (system) =>
          system.blocks.some((block) =>
            Match.value(block).pipe(
              Match.tag('CompactBoundary', () => true),
              Match.orElse(() => false),
            ),
          ),
        ),
        Match.orElse(() => false),
      ),
  })

const boundaryKey = (line: TranscriptLine): string =>
  TranscriptLine.$match(line, {
    SessionCleared: ({ session }) => `${session} cleared`,
    Message: ({ session, message }) => `compact ${session} ${message.offset}`,
  })

const place = (lines: readonly TranscriptLine[]) =>
  Arr.mapAccum(
    lines,
    { turn: 0, boundary: Option.none<string>() },
    (state, line): readonly [{ turn: number; boundary: Option.Option<string> }, Placed] => {
      const turn = startsTurn(line) ? state.turn + 1 : state.turn
      const boundary = isBoundary(line) ? Option.some(boundaryKey(line)) : state.boundary

      return [
        { turn, boundary },
        { line, turn, boundary },
      ]
    },
  )

const messageOf = (line: TranscriptLine): Option.Option<TranscriptMessage> =>
  TranscriptLine.$match(line, {
    SessionCleared: () => Option.none(),
    Message: ({ message }) => Option.some(message),
  })

const userMessageOf = (line: TranscriptLine): Option.Option<UserMessage> =>
  Option.flatMap(messageOf(line), (message) =>
    Match.value(message).pipe(
      Match.tag('User', (user) => Option.some(user)),
      Match.orElse(() => Option.none()),
    ),
  )

const resultsIn = (lines: readonly TranscriptLine[]) =>
  new Map(
    pipe(
      lines,
      Arr.flatMap((line) => Option.toArray(userMessageOf(line))),
      Arr.flatMap((user) =>
        Arr.flatMap(user.blocks, (block) =>
          Match.value(block).pipe(
            Match.tag(
              'ToolResult',
              (result): readonly (readonly [string, Stamped<ToolResultBlock>])[] => [
                [result.toolUseId, { value: result, at: user.timestamp }],
              ],
            ),
            Match.orElse(() => []),
          ),
        ),
      ),
    ),
  )

const noticesIn = (lines: readonly TranscriptLine[]) =>
  new Map(
    pipe(
      lines,
      Arr.flatMap((line) => Option.toArray(userMessageOf(line))),
      Arr.flatMap((user) =>
        Arr.flatMap(user.blocks, (block) =>
          Match.value(block).pipe(
            Match.tag(
              'TaskNotification',
              (notice): readonly (readonly [string, Stamped<string>])[] =>
                pipe(
                  Option.all({ toolUseId: notice.toolUseId, status: notice.status }),
                  Option.map(({ toolUseId, status }): readonly [string, Stamped<string>] => [
                    toolUseId,
                    { value: status, at: user.timestamp },
                  ]),
                  Option.toArray,
                ),
            ),
            Match.orElse(() => []),
          ),
        ),
      ),
    ),
  )

const draft = (item: ChatItem): Draft => ({ item, group: Option.none() })

const grouped = (item: ChatItem, group: string): Draft => ({ item, group: Option.some(group) })

const toolStatus = (
  result: Option.Option<ToolResultBlock>,
  turn: number,
  evidence: Evidence,
): ToolStatus =>
  Option.match(result, {
    onSome: (found): ToolStatus => (found.isError ? 'error' : 'success'),
    onNone: (): ToolStatus => {
      if (turn < evidence.lastTurn || evidence.context.activity === 'still') {
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
  const result = stampedValue(Option.fromUndefinedOr(evidence.results.get(use.id)))
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
    turnOver: turn < evidence.lastTurn || evidence.context.activity === 'still',
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
            stampedAt(Option.fromUndefinedOr(evidence.results.get(use.id))),
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

const textOf = (message: UserMessage): string =>
  pipe(
    message.blocks,
    Arr.flatMap((block) =>
      Match.value(block).pipe(
        Match.tag('Text', (text) => [text.text]),
        Match.orElse(() => []),
      ),
    ),
    Arr.join('\n\n'),
  ).trim()

const imagesOf = (message: UserMessage): readonly ImageBlock[] =>
  Arr.flatMap(message.blocks, (block) =>
    Match.value(block).pipe(
      Match.tag('Image', (image) => [image]),
      Match.orElse(() => []),
    ),
  )

const promptDraft = (message: UserMessage, key: string): readonly Draft[] => {
  const text = textOf(message)
  const images = imagesOf(message)

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
        LocalCommandOutput: (output) =>
          Str.isNonEmpty(output.text.trim())
            ? [draft(ChatItem.Note({ key: keyAt(index), text: output.text.trim() }))]
            : [],
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
  boundary: string,
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
            boundary,
          ),
        ],
        TurnDuration: () => [],
        LocalCommandOutput: (output) =>
          Str.isNonEmpty(output.text.trim())
            ? [draft(ChatItem.Note({ key: keyAt(index), text: output.text.trim() }))]
            : [],
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
          System: (system) => systemDrafts(system, keyAt, boundaryKey(placed.line)),
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

export const itemKey = (item: ChatItem): string => item.key

export const runsIn = (items: readonly ChatItem[]): readonly SubagentRun[] =>
  Arr.flatMap(items, (item) => (isSubagents(item) ? item.runs : []))

export const isRunning = (run: SubagentRun): boolean => run.status === 'running'

export const runningCount = (items: readonly ChatItem[]): number =>
  Arr.filter(runsIn(items), isRunning).length

export const hasToolRunning = (items: readonly ChatItem[]): boolean =>
  Option.exists(
    Arr.last(items),
    (item) =>
      (isTool(item) && item.call.status === 'running') ||
      (isSubagents(item) && item.runs.some((run) => !run.background && isRunning(run))),
  )
