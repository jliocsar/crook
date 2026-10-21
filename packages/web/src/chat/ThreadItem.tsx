import { cn } from 'cn'
import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import {
  ChevronDown,
  CircleCheck,
  Circle,
  CircleDot,
  FilePen,
  FilePlus,
  FileText,
  Globe,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react'
import * as React from 'react'

import { relativeToFolder } from '@crook/domain/Ask'
import type { ImageBlock, PatchHunk, ToolResultBlock } from '@crook/domain/TranscriptMessage'
import type { ChatItem, PlanStep, SubagentRun, ToolCallModel } from '@crook/web/chat/ChatItems'
import { ChatItem as ChatItems, stringField, toolTitle } from '@crook/web/chat/ChatItems'
import { Thumbs } from '@crook/web/chat/Images'
import type { Picture } from '@crook/web/chat/Images'
import { Collapse } from '@crook/web/components/Collapse'
import { CodeBlock } from '@crook/web/components/ui/code-block'
import { DiffView } from '@crook/web/components/ui/diff-view'
import type { DiffHunk } from '@crook/web/components/ui/diff-view'
import { Message } from '@crook/web/components/ui/message'
import { Response } from '@crook/web/components/ui/response'
import { SubagentTree } from '@crook/web/components/ui/subagent-tree'
import type { AgentRun } from '@crook/web/components/ui/subagent-tree'
import { ToolCall } from '@crook/web/components/ui/tool-call'
import { languageOfPath } from '@crook/web/highlight/Highlighter'
import { spanDuration } from '@crook/web/time/Elapsed'

export interface ThreadEnvironment {
  readonly now: DateTime.Utc
  readonly cwd: string
  readonly paneClosed: boolean
  readonly onShowEarlier: () => void
  readonly onOpenRun: (run: SubagentRun) => void
}

const TOOL_ICON_SIZE = 15
const OUTPUT_CLASS = 'max-h-56 overflow-y-auto'
const PATH_FIELD = 'file_path'
const SHELL_LANGUAGE = 'shellscript'
const PANE_CLOSED_NOTE = 'Pane closed'
const BYTES_PER_KILOBYTE = 1024

const TOOL_ICON = new Map([
  ['Read', FileText],
  ['Bash', SquareTerminal],
  ['Edit', FilePen],
  ['MultiEdit', FilePen],
  ['Write', FilePlus],
  ['NotebookEdit', FilePen],
  ['Grep', Search],
  ['Glob', Search],
  ['WebFetch', Globe],
  ['WebSearch', Globe],
])

const EditInput = Schema.Struct({ old_string: Schema.String, new_string: Schema.String })

const decodeEditInput = Schema.decodeUnknownOption(EditInput)

const STEP_ICON = {
  pending: Circle,
  in_progress: CircleDot,
  completed: CircleCheck,
} satisfies Record<PlanStep['status'], typeof Circle>

const resultText = (result: ToolResultBlock): string =>
  pipe(
    result.content,
    Arr.flatMap((block) =>
      Match.value(block).pipe(
        Match.tag('Text', (text) => [text.text]),
        Match.orElse(() => []),
      ),
    ),
    Arr.join('\n'),
  )

const resultImages = (result: Option.Option<ToolResultBlock>): readonly ImageBlock[] =>
  Option.match(result, {
    onNone: () => [],
    onSome: (found) =>
      Arr.flatMap(found.content, (block) =>
        Match.value(block).pipe(
          Match.tag('Image', (image) => [image]),
          Match.orElse(() => []),
        ),
      ),
  })

const fileName = (path: string): string => path.split('/').at(-1) ?? path

const pathOf = (call: ToolCallModel): Option.Option<string> => stringField(call.input, PATH_FIELD)

const picturesOf = (call: ToolCallModel): readonly Picture[] => {
  const name = Option.getOrElse(Option.map(pathOf(call), fileName), () => `${call.name} image`)

  return resultImages(call.result).map((image) => ({ image, name }))
}

const inputHunks = (call: ToolCallModel): Option.Option<readonly DiffHunk[]> =>
  Option.map(decodeEditInput(call.input), (edit) => [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        ...edit.old_string.split('\n').map((line) => `-${line}`),
        ...edit.new_string.split('\n').map((line) => `+${line}`),
      ],
    },
  ])

const patchHunks = (call: ToolCallModel): Option.Option<readonly PatchHunk[]> =>
  pipe(
    call.result,
    Option.flatMap((result) => result.patch),
    Option.filter(Arr.isReadonlyArrayNonEmpty),
  )

const toolDuration = (call: ToolCallModel, now: DateTime.Utc): string | undefined =>
  pipe(
    Option.all({
      from: call.startedAt,
      to: Option.orElse(call.finishedAt, () =>
        Option.liftPredicate(now, () => call.status === 'running'),
      ),
    }),
    Option.map(({ from, to }) => spanDuration(from, to)),
    Option.getOrUndefined,
  )

const runMeta = (run: SubagentRun): string =>
  pipe(
    [Option.some(run.agentType), run.model],
    Arr.getSomes,
    Arr.filter((part) => part !== ''),
    Arr.join(' · '),
  )

export const runStatusShown = (run: SubagentRun, paneClosed: boolean): SubagentRun['status'] =>
  paneClosed && run.status === 'running' ? 'failed' : run.status

const treeRun = (run: SubagentRun, environment: ThreadEnvironment): AgentRun => {
  const status = runStatusShown(run, environment.paneClosed)

  return {
    id: run.toolUseId,
    label: run.description,
    status,
    meta: status === 'failed' && run.status === 'running' ? PANE_CLOSED_NOTE : runMeta(run),
    duration: pipe(
      Option.all({
        from: run.startedAt,
        to: Option.orElse(run.finishedAt, () => Option.some(environment.now)),
      }),
      Option.map(({ from, to }) => spanDuration(from, to)),
      Option.getOrUndefined,
    ),
    selectable: Option.isSome(run.subagent),
  }
}

const renderCode = (code: string, language: Option.Option<string>) => (
  <CodeBlock code={code} language={Option.getOrUndefined(language)} />
)

export const omittedLabel = (byteLength: number): string =>
  `Earlier messages not loaded (${Math.ceil(byteLength / BYTES_PER_KILOBYTE)} KB)`

function OutputText({ text, failed }: { text: string; failed: boolean }) {
  return (
    <pre
      className={cn(
        'bg-muted/60 overflow-x-auto rounded-[calc(var(--radius)-0.25rem)] p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words',
        OUTPUT_CLASS,
        failed && 'text-destructive',
      )}
    >
      {text}
    </pre>
  )
}

function ResultOutput({
  call,
  language,
}: {
  call: ToolCallModel
  language: Option.Option<string>
}) {
  return Option.match(call.result, {
    onNone: () => null,
    onSome: (result) => {
      const text = resultText(result)

      if (text.trim() === '') {
        return null
      }

      return result.isError || Option.isNone(language) ? (
        <OutputText text={text} failed={result.isError} />
      ) : (
        <CodeBlock
          code={text}
          language={Option.getOrUndefined(language)}
          className={OUTPUT_CLASS}
        />
      )
    },
  })
}

function ToolPanel({ call, cwd }: { call: ToolCallModel; cwd: string }) {
  const path = pathOf(call)
  const shownPath = Option.map(path, (found) => relativeToFolder(cwd, found))
  const language = Option.flatMap(path, languageOfPath)

  if (call.name === 'Edit' || call.name === 'MultiEdit') {
    return Option.match(
      Option.orElse(patchHunks(call), () => inputHunks(call)),
      {
        onNone: () => <ResultOutput call={call} language={Option.none()} />,
        onSome: (hunks) => <DiffView hunks={hunks} filename={Option.getOrUndefined(shownPath)} />,
      },
    )
  }

  if (call.name === 'Write') {
    return Option.match(stringField(call.input, 'content'), {
      onNone: () => null,
      onSome: (code) => (
        <CodeBlock
          code={code}
          filename={Option.getOrUndefined(shownPath)}
          language={Option.getOrUndefined(language)}
          className={OUTPUT_CLASS}
        />
      ),
    })
  }

  if (call.name === 'Bash') {
    return (
      <>
        {Option.match(stringField(call.input, 'command'), {
          onNone: () => null,
          onSome: (command) => <CodeBlock code={command} language={SHELL_LANGUAGE} wrap />,
        })}
        <ResultOutput call={call} language={Option.none()} />
      </>
    )
  }

  if (call.name === 'Read') {
    return <ResultOutput call={call} language={language} />
  }

  return (
    <>
      <OutputText text={JSON.stringify(call.input, null, 2)} failed={false} />
      <ResultOutput call={call} language={Option.none()} />
    </>
  )
}

export function ToolCard({
  call,
  environment,
}: {
  call: ToolCallModel
  environment: ThreadEnvironment
}) {
  const Icon = TOOL_ICON.get(call.name) ?? Wrench

  return (
    <ToolCall
      name={toolTitle(call)}
      status={call.status}
      icon={<Icon size={TOOL_ICON_SIZE} />}
      duration={toolDuration(call, environment.now)}
      panel={<ToolPanel call={call} cwd={environment.cwd} />}
      footer={<Thumbs pictures={picturesOf(call)} place="tool" />}
    />
  )
}

function SubagentRuns({
  runs,
  environment,
}: {
  runs: readonly SubagentRun[]
  environment: ThreadEnvironment
}) {
  return (
    <SubagentTree
      runs={runs.map((run) => treeRun(run, environment))}
      onSelectRun={(selected) => {
        Option.map(
          Arr.findFirst(runs, (run) => run.toolUseId === selected.id),
          environment.onOpenRun,
        )
      }}
    />
  )
}

function PlanChecklist({ steps }: { steps: readonly PlanStep[] }) {
  const done = steps.filter((step) => step.status === 'completed').length

  return (
    <section data-slot="plan" className="border-border bg-card rounded-[var(--radius)] border p-3">
      <p className="text-muted-foreground mb-2 flex items-baseline text-xs">
        <span className="font-medium">Plan</span>
        <span className="ms-auto tabular-nums">
          {done}/{steps.length} done
        </span>
      </p>
      <ul className="grid gap-1.5">
        {steps.map((step, index) => {
          const StepIcon = STEP_ICON[step.status]

          return (
            <li
              key={index}
              data-status={step.status}
              className="flex items-start gap-2 text-sm leading-5"
            >
              <StepIcon
                aria-hidden="true"
                size={TOOL_ICON_SIZE}
                className={cn(
                  'mt-0.5 shrink-0',
                  step.status === 'in_progress' ? 'text-primary' : 'text-muted-foreground',
                )}
              />
              <span
                className={cn(step.status === 'completed' && 'text-muted-foreground line-through')}
              >
                {step.content}
              </span>
              <span className="sr-only">, {step.status.replace('_', ' ')}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground py-1 text-center text-xs leading-4 whitespace-pre-wrap">
      {children}
    </p>
  )
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="separator"
      className="text-muted-foreground flex items-center gap-3 py-1 text-xs leading-4"
    >
      <span aria-hidden="true" className="bg-border h-px flex-1" />
      <span className="shrink-0">{children}</span>
      <span aria-hidden="true" className="bg-border h-px flex-1" />
    </div>
  )
}

function CompactedDivider({ summary }: { summary: Option.Option<string> }) {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="grid gap-2">
      <Divider>Conversation compacted</Divider>
      {Option.match(summary, {
        onNone: () => null,
        onSome: (text) => (
          <>
            <button
              type="button"
              aria-expanded={open}
              className="text-muted-foreground hover:text-foreground mx-auto inline-flex min-h-11 items-center gap-1 px-2 text-xs font-semibold"
              onClick={() => {
                setOpen(!open)
              }}
            >
              {open ? 'Hide summary' : 'Show summary'}
              <ChevronDown
                aria-hidden="true"
                size={TOOL_ICON_SIZE}
                className={cn(
                  'transition-transform duration-200 motion-reduce:transition-none',
                  open && 'rotate-180',
                )}
              />
            </button>
            <Collapse open={open}>
              <Response className="text-muted-foreground border-border rounded-[var(--radius)] border p-3 text-sm leading-5">
                {text}
              </Response>
            </Collapse>
          </>
        ),
      })}
    </div>
  )
}

export function ThreadItem({
  item,
  environment,
}: {
  item: ChatItem
  environment: ThreadEnvironment
}) {
  return ChatItems.$match(item, {
    UserPrompt: (prompt) => (
      <Message role="user" meta={prompt.queued ? 'Queued' : undefined}>
        <Thumbs
          pictures={prompt.images.map((image) => ({ image, name: 'Pasted image' }))}
          place="message"
          className={cn('ms-auto w-fit max-w-full', prompt.text !== '' && 'mb-2')}
        />
        {prompt.text}
      </Message>
    ),
    AssistantText: (text) => (
      <Response className={cn('py-1', text.failed && 'text-destructive')} renderCode={renderCode}>
        {text.text}
      </Response>
    ),
    Tool: (tool) => <ToolCard call={tool.call} environment={environment} />,
    Subagents: (subagents) => <SubagentRuns runs={subagents.runs} environment={environment} />,
    Plan: (plan) => <PlanChecklist steps={plan.steps} />,
    Note: (note) => <Note>{note.text}</Note>,
    Compacted: (compacted) => <CompactedDivider summary={compacted.summary} />,
    Cleared: () => <Divider>Conversation cleared</Divider>,
    Omitted: (omitted) => (
      <div className="grid justify-items-center gap-1 py-1">
        <Note>{omittedLabel(omitted.byteLength)}</Note>
        <button
          type="button"
          className="text-primary inline-flex min-h-11 items-center px-3 text-sm font-semibold"
          onClick={environment.onShowEarlier}
        >
          Show earlier messages
        </button>
      </div>
    ),
    Unreadable: (unreadable) => (
      <Note>{`A line crook could not read (${unreadable.byteLength} bytes)`}</Note>
    ),
  })
}
