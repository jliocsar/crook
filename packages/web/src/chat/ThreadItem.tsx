import { cn } from 'cn'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
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
import type { ChatItem, PlanStep, SubagentRun, ToolCallModel } from '@crook/web/chat/ChatItems'
import { ChatItem as ChatItems, stringField, toolTitle } from '@crook/web/chat/ChatItems'
import { Thumbs } from '@crook/web/chat/Images'
import { RowAction } from '@crook/web/chat/RowAction'
import {
  inputHunks,
  omittedLabel,
  patchHunks,
  pathOf,
  picturesOf,
  resultText,
  runStatusShown,
  toolDuration,
  treeRun,
  withoutLineNumbers,
} from '@crook/web/chat/ToolView'
import { Collapse } from '@crook/web/components/Collapse'
import { OutputText } from '@crook/web/components/OutputText'
import { useRowFlag } from '@crook/web/components/RowMemory'
import { CodeBlock } from '@crook/web/components/ui/code-block'
import { DiffView } from '@crook/web/components/ui/diff-view'
import { Message } from '@crook/web/components/ui/message'
import { Response } from '@crook/web/components/ui/response'
import { SubagentTree } from '@crook/web/components/ui/subagent-tree'
import { ToolCall } from '@crook/web/components/ui/tool-call'
import {
  HIGHLIGHT_LINE_LIMIT,
  languageOfPath,
  SHELL_LANGUAGE,
} from '@crook/web/highlight/Highlighter'
import { useNow } from '@crook/web/time/Now'

export interface ThreadEnvironment {
  readonly cwd: string
  readonly paneClosed: boolean
  readonly onShowEarlier: () => void
  readonly onOpenRun: Option.Option<(run: SubagentRun) => void>
}

const INLINE_ICON_SIZE = 15
const OUTPUT_CLASS = 'max-h-56 overflow-y-auto'

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

const STEP_ICON = {
  pending: Circle,
  in_progress: CircleDot,
  completed: CircleCheck,
} satisfies Record<PlanStep['status'], typeof Circle>

const sameItem = (
  previous: { readonly item: ChatItem; readonly environment: ThreadEnvironment },
  next: { readonly item: ChatItem; readonly environment: ThreadEnvironment },
): boolean => previous.environment === next.environment && Equal.equals(previous.item, next.item)

const renderCode = (code: string, language: Option.Option<string>) => (
  <CodeBlock code={code} language={Option.getOrUndefined(language)} />
)

const ToolPanelMemo = React.memo(ToolPanel)

export const ThreadItem = React.memo(ThreadItemView, sameItem)

function ResultOutput({
  call,
  language,
  numbered = false,
}: {
  call: ToolCallModel
  language: Option.Option<string>
  numbered?: boolean
}) {
  return Option.match(call.result, {
    onNone: () => null,
    onSome: (result) => {
      const text = numbered ? withoutLineNumbers(resultText(result)) : resultText(result)

      if (text.trim() === '') {
        return null
      }

      return result.isError || Option.isNone(language) ? (
        <OutputText
          text={text}
          className={cn(OUTPUT_CLASS, result.isError && 'text-destructive')}
        />
      ) : (
        <CodeBlock
          code={text}
          language={Option.getOrUndefined(language)}
          maxLines={HIGHLIGHT_LINE_LIMIT}
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
        onSome: (hunks) => (
          <DiffView
            hunks={hunks}
            filename={Option.getOrUndefined(shownPath)}
            maxLines={HIGHLIGHT_LINE_LIMIT}
          />
        ),
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
          maxLines={HIGHLIGHT_LINE_LIMIT}
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
    return <ResultOutput call={call} language={language} numbered />
  }

  return (
    <>
      <OutputText text={JSON.stringify(call.input, null, 2)} className={OUTPUT_CLASS} />
      <ResultOutput call={call} language={Option.none()} />
    </>
  )
}

function ToolCard({ call, environment }: { call: ToolCallModel; environment: ThreadEnvironment }) {
  const Icon = TOOL_ICON.get(call.name) ?? Wrench
  const now = useNow(call.status === 'running')

  return (
    <ToolCall
      name={toolTitle(call)}
      status={call.status}
      icon={<Icon size={INLINE_ICON_SIZE} />}
      duration={toolDuration(call, now)}
      panel={<ToolPanelMemo call={call} cwd={environment.cwd} />}
      footer={Option.map(
        Option.liftPredicate(picturesOf(call), Arr.isReadonlyArrayNonEmpty),
        (pictures) => (
          <Thumbs pictures={pictures} place="tool" />
        ),
      )}
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
  const now = useNow(runs.some((run) => runStatusShown(run, environment.paneClosed) === 'running'))

  return (
    <SubagentTree
      runs={runs.map((run) =>
        treeRun(run, {
          now,
          paneClosed: environment.paneClosed,
          opensRuns: Option.isSome(environment.onOpenRun),
        }),
      )}
      onSelectRun={(selected) => {
        Option.match(
          Option.all({
            open: environment.onOpenRun,
            run: Arr.findFirst(runs, (run) => run.toolUseId === selected.id),
          }),
          {
            onNone: () => undefined,
            onSome: ({ open, run }) => {
              open(run)
            },
          },
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
                size={INLINE_ICON_SIZE}
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
  const [open, setOpen] = useRowFlag('summary', false)

  return (
    <div className="grid grid-cols-1 gap-2">
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
                size={INLINE_ICON_SIZE}
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

function ThreadItemView({ item, environment }: { item: ChatItem; environment: ThreadEnvironment }) {
  return ChatItems.$match(item, {
    UserPrompt: (prompt) => (
      <Message meta={prompt.queued ? 'Queued' : undefined}>
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
      <RowAction label="Show earlier messages" onAction={environment.onShowEarlier}>
        <Note>{omittedLabel(omitted.byteLength)}</Note>
      </RowAction>
    ),
    Unreadable: (unreadable) => (
      <Note>{`A line crook could not read (${unreadable.byteLength} bytes)`}</Note>
    ),
  })
}
