import { cn } from 'cn'
import * as React from 'react'

import { OutputText } from '@crook/web/components/OutputText'
import { useRowFlag } from '@crook/web/components/RowMemory'
import { ExpandToggle } from '@crook/web/components/ui/code-block'
import {
  foldedLines,
  FOLDED_OUTPUT_CHARACTERS,
  FOLDED_OUTPUT_LINES,
  LINE_BREAK,
} from '@crook/web/text/Lines'

const EXPANDED_CLASS = 'max-h-96 overflow-y-auto'

export function FoldedOutput({
  text,
  memorySlot,
  failed = false,
}: {
  text: string
  memorySlot: string
  failed?: boolean
}) {
  const [expanded, setExpanded] = useRowFlag(memorySlot, false)
  const lines = React.useMemo(() => text.split(LINE_BREAK), [text])
  const folded = React.useMemo(
    () => foldedLines(lines, FOLDED_OUTPUT_LINES, FOLDED_OUTPUT_CHARACTERS),
    [lines],
  )
  const shown = folded.clipped && !expanded ? folded.lines.join(LINE_BREAK) : text

  return (
    <div
      data-slot="folded-output"
      className="bg-muted/60 min-w-0 overflow-hidden rounded-[calc(var(--radius)-0.25rem)]"
    >
      <OutputText
        text={shown}
        className={cn(
          'rounded-none bg-transparent',
          failed && 'text-destructive',
          expanded && EXPANDED_CLASS,
        )}
      />
      {folded.clipped ? (
        <ExpandToggle
          expanded={expanded}
          hidden={lines.length - folded.lines.length}
          onToggle={() => {
            setExpanded(!expanded)
          }}
        />
      ) : null}
    </div>
  )
}
