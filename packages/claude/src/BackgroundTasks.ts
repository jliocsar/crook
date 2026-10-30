import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Struct from 'effect/Struct'

import { parseLine } from '@crook/claude/TranscriptParser'
import { BackgroundTask, MonitorEvent, MonitorTask, ShellTask } from '@crook/domain/Background'
import type { TranscriptOffset } from '@crook/domain/Ids'
import { type SubagentStatus, statusOfNotice } from '@crook/domain/Subagent'
import type {
  AssistantMessage,
  TaskNotificationBlock,
  ToolResultBlock,
  ToolUseBlock,
  TranscriptMessage,
  UserMessage,
} from '@crook/domain/TranscriptMessage'

type Moment = Option.Option<DateTime.Utc>

type LaunchKind = 'shell' | 'monitor'

interface ToolCall {
  readonly command: Option.Option<string>
  readonly description: Option.Option<string>
  readonly at: Moment
}

interface Launch {
  readonly kind: LaunchKind
  readonly taskId: string
  readonly toolUseId: string
  readonly call: ToolCall
}

interface TaskEntry {
  readonly taskId: string
  readonly outputFile: Option.Option<string>
  readonly expiresAt: Moment
  readonly status: Option.Option<SubagentStatus>
  readonly summary: Option.Option<string>
  readonly endedAt: Moment
  readonly stoppedByClaude: boolean
  readonly checkedAt: readonly DateTime.Utc[]
  readonly events: readonly MonitorEvent[]
}

interface FoundTask {
  readonly kind: LaunchKind
  readonly taskId: string
  readonly timeoutMs: Option.Option<number>
}

export interface BackgroundLedger {
  readonly shellCalls: HashMap.HashMap<string, ToolCall>
  readonly monitorCalls: HashMap.HashMap<string, ToolCall>
  readonly launches: readonly Launch[]
  readonly tasks: HashMap.HashMap<string, TaskEntry>
}

const SHELL_TOOL = 'Bash'
const MONITOR_TOOL = 'Monitor'
const STOP_TOOL = 'TaskStop'
const READ_TOOL = 'Read'
const OUTPUT_EXTENSION = '.output'
const TASKS_DIRECTORY = '/tasks/'
const OUTPUT_PATH = /Output is being written to: (\S+\.output)/u
const SHELL_TASK_ID = /(?:running in background with ID: |moved to the background \(ID: )(\w+)/u
const MONITOR_TASK_ID = /Monitor started \(task (\w+)/u
const QUOTED = /"([^"]+)"/u

const BACKGROUND_MARKERS = [
  '"name":"Bash"',
  '"name":"Monitor"',
  '"name":"TaskStop"',
  '.output"',
  'in background with ID',
  'to the background (ID',
  'Monitor started (task',
  '<task-notification>',
]

const ShellInput = Schema.Struct({
  command: Schema.String,
  description: Schema.optionalKey(Schema.String),
})

const MonitorInput = Schema.Struct({
  description: Schema.String,
  command: Schema.optionalKey(Schema.String),
})

const StopInput = Schema.Struct({ task_id: Schema.String })

const ReadInput = Schema.Struct({ file_path: Schema.String })

const decodeShellInput = Schema.decodeUnknownOption(ShellInput)
const decodeMonitorInput = Schema.decodeUnknownOption(MonitorInput)
const decodeStopInput = Schema.decodeUnknownOption(StopInput)
const decodeReadInput = Schema.decodeUnknownOption(ReadInput)

const decoder = new TextDecoder()

const isSameTasks = Schema.toEquivalence(Schema.Array(BackgroundTask))

const entryFor = (taskId: string): TaskEntry => ({
  taskId,
  outputFile: Option.none(),
  expiresAt: Option.none(),
  status: Option.none(),
  summary: Option.none(),
  endedAt: Option.none(),
  stoppedByClaude: false,
  checkedAt: [],
  events: [],
})

const updateTask = (
  ledger: BackgroundLedger,
  taskId: string,
  change: (entry: TaskEntry) => TaskEntry,
): BackgroundLedger =>
  Struct.evolve(ledger, {
    tasks: (tasks) =>
      HashMap.set(
        tasks,
        taskId,
        change(Option.getOrElse(HashMap.get(tasks, taskId), () => entryFor(taskId))),
      ),
  })

export const taskIdOfOutput = (path: string): Option.Option<string> =>
  pipe(
    Option.liftPredicate(
      path,
      (found) => found.includes(TASKS_DIRECTORY) && found.endsWith(OUTPUT_EXTENSION),
    ),
    Option.map((found) => found.slice(found.lastIndexOf('/') + 1, -OUTPUT_EXTENSION.length)),
  )

const withShellCall = (ledger: BackgroundLedger, use: ToolUseBlock, at: Moment) =>
  Option.map(decodeShellInput(use.input), (input) =>
    Struct.evolve(ledger, {
      shellCalls: (calls) =>
        HashMap.set(calls, use.id, {
          command: Option.some(input.command),
          description: Option.fromUndefinedOr(input.description),
          at,
        }),
    }),
  )

const withMonitorCall = (ledger: BackgroundLedger, use: ToolUseBlock, at: Moment) =>
  Option.map(decodeMonitorInput(use.input), (input) =>
    Struct.evolve(ledger, {
      monitorCalls: (calls) =>
        HashMap.set(calls, use.id, {
          command: Option.fromUndefinedOr(input.command),
          description: Option.some(input.description),
          at,
        }),
    }),
  )

const withStop = (ledger: BackgroundLedger, use: ToolUseBlock, at: Moment) =>
  Option.map(decodeStopInput(use.input), (input) =>
    updateTask(ledger, input.task_id, (entry) =>
      Struct.evolve(entry, {
        stoppedByClaude: () => true,
        status: (known) => Option.orElse(known, () => Option.some<SubagentStatus>('stopped')),
        endedAt: (known) => Option.orElse(known, () => at),
      }),
    ),
  )

const withOutputRead = (ledger: BackgroundLedger, use: ToolUseBlock, at: Moment) =>
  pipe(
    decodeReadInput(use.input),
    Option.flatMap((input) => taskIdOfOutput(input.file_path)),
    Option.flatMap((taskId) =>
      Option.map(at, (moment) =>
        updateTask(ledger, taskId, (entry) =>
          Struct.evolve(entry, { checkedAt: (checks) => Arr.append(checks, moment) }),
        ),
      ),
    ),
  )

const afterToolUse =
  (at: Moment) =>
  (ledger: BackgroundLedger, use: ToolUseBlock): BackgroundLedger =>
    Match.value(use.name).pipe(
      Match.when(SHELL_TOOL, () => withShellCall(ledger, use, at)),
      Match.when(MONITOR_TOOL, () => withMonitorCall(ledger, use, at)),
      Match.when(STOP_TOOL, () => withStop(ledger, use, at)),
      Match.when(READ_TOOL, () => withOutputRead(ledger, use, at)),
      Match.orElse(() => Option.none<BackgroundLedger>()),
      Option.getOrElse(() => ledger),
    )

const textsOf = (result: ToolResultBlock): readonly string[] =>
  Arr.flatMap(result.content, (content) =>
    Match.value(content).pipe(
      Match.tag('Text', (text) => [text.text]),
      Match.orElse(() => []),
    ),
  )

const firstMatch = (texts: readonly string[], pattern: RegExp): Option.Option<string> =>
  Arr.findFirst(texts, (text) => Option.fromNullishOr(pattern.exec(text)?.[1]))

const taskOfResult = (ledger: BackgroundLedger, result: ToolResultBlock) => {
  const texts = textsOf(result)
  const isMonitor =
    HashMap.has(ledger.monitorCalls, result.toolUseId) ||
    Option.isSome(firstMatch(texts, MONITOR_TASK_ID))

  return pipe(
    Option.map(result.task, (task) => ({ taskId: task.taskId, timeoutMs: task.timeoutMs })),
    Option.orElse(() =>
      Option.map(
        Option.orElse(firstMatch(texts, SHELL_TASK_ID), () => firstMatch(texts, MONITOR_TASK_ID)),
        (taskId) => ({ taskId, timeoutMs: Option.none<number>() }),
      ),
    ),
    Option.map((found): FoundTask => ({
      kind: isMonitor ? 'monitor' : 'shell',
      taskId: found.taskId,
      timeoutMs: found.timeoutMs,
    })),
  )
}

const expiryOf = (at: Moment, timeoutMs: Option.Option<number>): Moment =>
  Option.flatMap(at, (moment) =>
    Option.map(timeoutMs, (millis) => DateTime.addDuration(moment, Duration.millis(millis))),
  )

const callOf = (
  ledger: BackgroundLedger,
  found: FoundTask,
  toolUseId: string,
  at: Moment,
): ToolCall =>
  Option.getOrElse(
    HashMap.get(found.kind === 'monitor' ? ledger.monitorCalls : ledger.shellCalls, toolUseId),
    (): ToolCall => ({ command: Option.none(), description: Option.none(), at }),
  )

const launched = (
  ledger: BackgroundLedger,
  result: ToolResultBlock,
  found: FoundTask,
  at: Moment,
): BackgroundLedger =>
  updateTask(
    Struct.evolve(ledger, {
      launches: (launches) =>
        Arr.append(launches, {
          kind: found.kind,
          taskId: found.taskId,
          toolUseId: result.toolUseId,
          call: callOf(ledger, found, result.toolUseId, at),
        }),
    }),
    found.taskId,
    (entry) =>
      Struct.evolve(entry, {
        outputFile: (known) => Option.orElse(known, () => firstMatch(textsOf(result), OUTPUT_PATH)),
        expiresAt: () => expiryOf(at, found.timeoutMs),
      }),
  )

const withoutCall = (ledger: BackgroundLedger, toolUseId: string): BackgroundLedger => ({
  ...ledger,
  shellCalls: HashMap.remove(ledger.shellCalls, toolUseId),
  monitorCalls: HashMap.remove(ledger.monitorCalls, toolUseId),
})

const afterResult =
  (at: Moment) =>
  (ledger: BackgroundLedger, result: ToolResultBlock): BackgroundLedger =>
    withoutCall(
      Option.match(taskOfResult(ledger, result), {
        onNone: () => ledger,
        onSome: (found) => launched(ledger, result, found, at),
      }),
      result.toolUseId,
    )

const afterNotice =
  (at: Moment) =>
  (ledger: BackgroundLedger, notice: TaskNotificationBlock): BackgroundLedger =>
    updateTask(ledger, notice.taskId, (entry) =>
      Struct.evolve(entry, {
        outputFile: (known) => Option.orElse(notice.outputFile, () => known),
        status: (known) => Option.orElse(Option.map(notice.status, statusOfNotice), () => known),
        summary: (known) => Option.orElse(notice.summary, () => known),
        endedAt: (known) => (Option.isSome(notice.status) ? at : known),
        events: (events) =>
          Option.match(notice.event, {
            onNone: () => events,
            onSome: (text) => Arr.append(events, new MonitorEvent({ at, text })),
          }),
      }),
    )

const afterAssistant = (ledger: BackgroundLedger, message: AssistantMessage) =>
  Arr.reduce(message.blocks, ledger, (current, block) =>
    Match.value(block).pipe(
      Match.tag('ToolUse', (use) => afterToolUse(message.timestamp)(current, use)),
      Match.orElse(() => current),
    ),
  )

const afterUser = (ledger: BackgroundLedger, message: UserMessage) =>
  Arr.reduce(message.blocks, ledger, (current, block) =>
    Match.value(block).pipe(
      Match.tag('ToolResult', (result) => afterResult(message.timestamp)(current, result)),
      Match.tag('TaskNotification', (notice) => afterNotice(message.timestamp)(current, notice)),
      Match.orElse(() => current),
    ),
  )

const afterMessage = (ledger: BackgroundLedger, message: TranscriptMessage) =>
  Match.value(message).pipe(
    Match.tag('Assistant', (assistant) => afterAssistant(ledger, assistant)),
    Match.tag('User', (user) => afterUser(ledger, user)),
    Match.orElse(() => ledger),
  )

const quotedIn = (summary: Option.Option<string>): Option.Option<string> =>
  Option.flatMap(summary, (text) => Option.fromNullishOr(QUOTED.exec(text)?.[1]))

const taskOf =
  (ledger: BackgroundLedger) =>
  (launch: Launch): BackgroundTask => {
    const entry = Option.getOrElse(HashMap.get(ledger.tasks, launch.taskId), () =>
      entryFor(launch.taskId),
    )
    const description = Option.orElse(launch.call.description, () => quotedIn(entry.summary))
    const fields = {
      taskId: launch.taskId,
      toolUseId: launch.toolUseId,
      status: Option.getOrElse(entry.status, (): SubagentStatus => 'running'),
      summary: entry.summary,
      stoppedByClaude: entry.stoppedByClaude,
      startedAt: launch.call.at,
      endedAt: entry.endedAt,
    }

    return launch.kind === 'shell'
      ? new ShellTask({
          ...fields,
          command: launch.call.command,
          description,
          checkedAt: entry.checkedAt,
          output: [],
          lastOutputAt: Option.none(),
          alive: Option.none(),
        })
      : new MonitorTask({
          ...fields,
          description: Option.getOrElse(description, () => MONITOR_TOOL),
          command: launch.call.command,
          expiresAt: entry.expiresAt,
          events: entry.events,
        })
  }

export const EMPTY_LEDGER: BackgroundLedger = {
  shellCalls: HashMap.empty(),
  monitorCalls: HashMap.empty(),
  launches: [],
  tasks: HashMap.empty(),
}

export const backgroundLines = (
  bytes: Uint8Array,
  offset: TranscriptOffset,
): readonly TranscriptMessage[] => {
  const text = decoder.decode(bytes)

  return Arr.some(BACKGROUND_MARKERS, (marker) => text.includes(marker))
    ? parseLine(bytes, offset)
    : []
}

export const withBackgroundLines = (
  ledger: BackgroundLedger,
  messages: readonly TranscriptMessage[],
): BackgroundLedger => Arr.reduce(messages, ledger, afterMessage)

export const backgroundTasks = (ledger: BackgroundLedger): readonly BackgroundTask[] =>
  Arr.map(ledger.launches, taskOf(ledger))

export const outputFileOf = (ledger: BackgroundLedger, taskId: string): Option.Option<string> =>
  Option.flatMap(HashMap.get(ledger.tasks, taskId), (entry) => entry.outputFile)

export const sameTasks = (
  left: readonly BackgroundTask[],
  right: readonly BackgroundTask[],
): boolean => isSameTasks(left, right)
