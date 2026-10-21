import { cn } from 'cn'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import { FileDiff } from 'lucide-react'
import * as React from 'react'

import { languageOfPath, useHighlightedLines } from '@crook/web/highlight/Highlighter'

export type DiffLineKind = 'context' | 'add' | 'remove'

export type DiffHunk = {
  oldStart: number
  newStart: number
  lines: readonly string[]
}

export type DiffViewProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  hunks: readonly DiffHunk[]
  filename?: string | undefined
}

type DiffRow = { readonly kind: DiffLineKind; readonly text: string; readonly hunk: number }

const ICON_SIZE = 14
const NO_NEWLINE_MARK = '\\'

const kindOf = (line: string): DiffLineKind => {
  if (line.startsWith('+')) {
    return 'add'
  }

  return line.startsWith('-') ? 'remove' : 'context'
}

const rowsOf = (hunks: readonly DiffHunk[]): readonly DiffRow[] =>
  Arr.flatMap(hunks, (hunk, index) =>
    pipe(
      hunk.lines,
      Arr.filter((line) => !line.startsWith(NO_NEWLINE_MARK)),
      Arr.map((line): DiffRow => ({ kind: kindOf(line), text: line.slice(1), hunk: index })),
    ),
  )

const SIGN = { context: ' ', add: '+', remove: '-' } satisfies Record<DiffLineKind, string>

export function DiffView({ hunks, filename, className, ...rootProps }: DiffViewProps) {
  const rows = React.useMemo(() => rowsOf(hunks), [hunks])
  const code = React.useMemo(() => rows.map((row) => row.text).join('\n'), [rows])
  const highlighted = useHighlightedLines(
    code,
    Option.flatMap(Option.fromUndefinedOr(filename), languageOfPath),
  )
  const added = rows.filter((row) => row.kind === 'add').length
  const removed = rows.filter((row) => row.kind === 'remove').length

  return (
    <div
      data-slot="diff-view"
      className={cn(
        'border-border bg-muted/40 min-w-0 overflow-hidden rounded-[var(--radius)] border',
        className,
      )}
      {...rootProps}
    >
      <div className="border-border flex items-center gap-2 border-b px-3 py-1.5 text-xs">
        <FileDiff aria-hidden="true" size={ICON_SIZE} className="text-muted-foreground shrink-0" />
        <span className="text-muted-foreground min-w-0 truncate font-mono">
          {filename ?? 'Changes'}
        </span>
        <span className="ms-auto shrink-0 font-mono tabular-nums">
          <span className="text-accent">+{added}</span>{' '}
          <span className="text-destructive">-{removed}</span>
        </span>
      </div>
      <pre
        data-shiki={Option.isSome(highlighted) || undefined}
        tabIndex={0}
        className="m-0 overflow-x-auto py-1.5 font-[family-name:var(--font-mono),monospace] text-xs leading-relaxed"
      >
        <code className="block">
          {rows.map((row, index) => (
            <span
              key={index}
              data-kind={row.kind}
              className={cn(
                'flex px-3 whitespace-pre',
                row.kind === 'add' && 'bg-accent/10',
                row.kind === 'remove' && 'bg-destructive/10',
                index > 0 &&
                  rows[index - 1]?.hunk !== row.hunk &&
                  'border-border mt-1 border-t pt-1',
              )}
            >
              <span aria-hidden="true" className="text-muted-foreground mr-2 shrink-0 select-none">
                {SIGN[row.kind]}
              </span>
              <span className="sr-only">
                {row.kind === 'context' ? '' : `${row.kind === 'add' ? 'added' : 'removed'}: `}
              </span>
              <span className="min-w-0">
                {row.text === ''
                  ? ' '
                  : Option.getOrElse(
                      Option.flatMap(highlighted, (lines) => Option.fromUndefinedOr(lines[index])),
                      () => row.text,
                    )}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}
