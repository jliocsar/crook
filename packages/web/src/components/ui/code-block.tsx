import { cn } from 'cn'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { Check, ChevronDown, Clipboard, WrapText } from 'lucide-react'
import * as React from 'react'

import { useHighlightedLines } from '@crook/web/highlight/Highlighter'

type CopyState = 'idle' | 'copied' | 'error'

export type CodeBlockProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  code: string
  filename?: string | undefined
  language?: string | undefined
  showLineNumbers?: boolean
  highlightLines?: readonly number[]
  maxLines?: number
  wrap?: boolean
  wrappable?: boolean
  copyable?: boolean
  actions?: React.ReactNode
}

const COPY_FEEDBACK_MS = 1400

const BAR_BUTTON =
  'hit-area text-muted-foreground hover:bg-card hover:text-foreground relative inline-flex size-8 items-center justify-center rounded-md transition-colors duration-150 motion-reduce:transition-none'

const COPY_LABEL = {
  idle: 'Copy code',
  copied: 'Copied',
  error: 'Copy code',
} satisfies Record<CopyState, string>

const COPY_ANNOUNCEMENT = {
  idle: '',
  copied: 'Code copied to clipboard.',
  error: 'Code could not be copied.',
} satisfies Record<CopyState, string>

const moreLinesLabel = (hidden: number): string =>
  hidden === 1 ? 'Show 1 more line' : `Show ${hidden} more lines`

const useCopy = (code: string) => {
  const [copyState, setCopyState] = React.useState<CopyState>('idle')
  const pending = React.useRef<Option.Option<() => void>>(Option.none())

  const cancel = () => {
    if (Option.isSome(pending.current)) {
      pending.current.value()
    }

    pending.current = Option.none()
  }

  React.useEffect(() => cancel, [])

  const copy = () => {
    cancel()
    pending.current = Option.some(
      Effect.runCallback(
        Effect.tryPromise(() => navigator.clipboard.writeText(code)).pipe(
          Effect.match({
            onFailure: (): CopyState => 'error',
            onSuccess: (): CopyState => 'copied',
          }),
          Effect.flatMap((next) =>
            Effect.sync(() => {
              setCopyState(next)
            }),
          ),
          Effect.andThen(Effect.sleep(Duration.millis(COPY_FEEDBACK_MS))),
          Effect.andThen(
            Effect.sync(() => {
              setCopyState('idle')
            }),
          ),
        ),
      ),
    )
  }

  return { copyState, copy }
}

function CodeLine({
  line,
  content,
  number,
  marked,
  gutter,
  showLineNumbers,
  wrapped,
}: {
  line: string
  content: Option.Option<React.ReactNode>
  number: number
  marked: boolean
  gutter: number
  showLineNumbers: boolean
  wrapped: boolean
}) {
  return (
    <span
      data-highlighted={marked || undefined}
      className={cn(
        'flex px-3',
        marked && 'bg-primary/10 border-primary border-l-2 pl-[calc(0.75rem-2px)]',
      )}
    >
      {showLineNumbers ? (
        <span
          aria-hidden="true"
          className="text-muted-foreground/60 mr-3 shrink-0 text-right tabular-nums select-none"
          style={{ width: `${gutter}ch` }}
        >
          {number}
        </span>
      ) : null}
      <span
        className={cn('min-w-0', wrapped ? 'break-words whitespace-pre-wrap' : 'whitespace-pre')}
      >
        {line === '' ? ' ' : Option.getOrElse(content, () => line)}
      </span>
    </span>
  )
}

function CodeBlockBar({
  label,
  actions,
  wrappable,
  wrapped,
  onWrap,
  copyable,
  copyState,
  onCopy,
}: {
  label: string | undefined
  actions: React.ReactNode
  wrappable: boolean
  wrapped: boolean
  onWrap: () => void
  copyable: boolean
  copyState: CopyState
  onCopy: () => void
}) {
  if (label === undefined && !copyable && !wrappable && actions === undefined) {
    return null
  }

  return (
    <div
      data-slot="code-block-bar"
      className="border-border flex items-center gap-2 border-b px-3 py-1.5"
    >
      {label === undefined ? null : (
        <span className="text-muted-foreground truncate font-[family-name:var(--font-mono),monospace] text-xs">
          {label}
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {actions}

        {wrappable ? (
          <button
            type="button"
            aria-pressed={wrapped}
            aria-label="Wrap long lines"
            className={cn(BAR_BUTTON, 'aria-pressed:bg-card aria-pressed:text-foreground')}
            onClick={onWrap}
          >
            <WrapText aria-hidden="true" size={14} />
          </button>
        ) : null}

        {copyable ? (
          <button
            type="button"
            data-slot="code-block-copy"
            aria-label={COPY_LABEL[copyState]}
            className={BAR_BUTTON}
            onClick={onCopy}
          >
            {copyState === 'copied' ? (
              <Check aria-hidden="true" size={14} />
            ) : (
              <Clipboard aria-hidden="true" size={14} />
            )}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ExpandToggle({
  expanded,
  hidden,
  onToggle,
}: {
  expanded: boolean
  hidden: number
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      className="border-border text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1.5 border-t py-2 text-xs transition-colors duration-150 motion-reduce:transition-none"
      onClick={onToggle}
    >
      <ChevronDown
        aria-hidden="true"
        size={13}
        className={cn(
          'transition-transform duration-200 motion-reduce:transition-none',
          expanded && 'rotate-180',
        )}
      />
      {expanded ? 'Show less' : moreLinesLabel(hidden)}
    </button>
  )
}

export function CodeBlock({
  code,
  filename,
  language,
  showLineNumbers = false,
  highlightLines,
  maxLines,
  wrap = false,
  wrappable = false,
  copyable = true,
  actions,
  className,
  ...rootProps
}: CodeBlockProps) {
  const { copyState, copy } = useCopy(code)
  const [expanded, setExpanded] = React.useState(false)
  const [override, setOverride] = React.useState<Option.Option<boolean>>(Option.none())
  const wrapped = Option.getOrElse(override, () => wrap)
  const lines = React.useMemo(() => code.replace(/\n$/u, '').split('\n'), [code])
  const marked = React.useMemo(() => new Set(highlightLines ?? []), [highlightLines])
  const collapsible = maxLines !== undefined && lines.length > maxLines
  const clipped = collapsible && !expanded
  const shown = clipped ? lines.slice(0, maxLines) : lines
  const label = filename ?? language
  const highlighted = useHighlightedLines(code, Option.fromUndefinedOr(language))

  return (
    <div
      data-slot="code-block"
      className={cn(
        'border-border bg-muted/40 min-w-0 overflow-hidden rounded-[calc(var(--radius)+0.15rem)] border',
        className,
      )}
      {...rootProps}
    >
      <CodeBlockBar
        label={label}
        actions={actions}
        wrappable={wrappable}
        wrapped={wrapped}
        onWrap={() => {
          setOverride(Option.some(!wrapped))
        }}
        copyable={copyable}
        copyState={copyState}
        onCopy={copy}
      />

      <div className="relative">
        <pre
          data-slot="code-block-code"
          data-shiki={Option.isSome(highlighted) || undefined}
          tabIndex={0}
          className={cn(
            'text-foreground m-0 overflow-x-auto rounded-none bg-transparent px-0 py-2.5 font-[family-name:var(--font-mono),monospace] text-xs leading-relaxed',
            wrapped && 'overflow-x-visible',
          )}
        >
          <code className="block">
            {shown.map((line, index) => (
              <CodeLine
                key={index + 1}
                line={line}
                content={Option.flatMap(highlighted, (rows) => Option.fromUndefinedOr(rows[index]))}
                number={index + 1}
                marked={marked.has(index + 1)}
                gutter={String(lines.length).length}
                showLineNumbers={showLineNumbers}
                wrapped={wrapped}
              />
            ))}
          </code>
        </pre>

        {clipped ? (
          <div
            aria-hidden="true"
            className="from-muted/40 pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t to-transparent"
          />
        ) : null}
      </div>

      {collapsible ? (
        <ExpandToggle
          expanded={expanded}
          hidden={lines.length - shown.length}
          onToggle={() => {
            setExpanded((open) => !open)
          }}
        />
      ) : null}

      <span aria-live="polite" className="sr-only">
        {COPY_ANNOUNCEMENT[copyState]}
      </span>
    </div>
  )
}
