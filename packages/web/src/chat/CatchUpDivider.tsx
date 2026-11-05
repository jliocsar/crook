import * as Option from 'effect/Option'
import { Laptop } from 'lucide-react'
import * as React from 'react'

import {
  CatchUp,
  landedOf,
  lapseLabel,
  nextCatchUp,
  withCatchUpDivider,
} from '@crook/web/chat/CatchUp'
import type { Lapse } from '@crook/web/chat/CatchUp'
import type { ThreadRow } from '@crook/web/chat/Thread'
import type { TranscriptView } from '@crook/web/chat/TranscriptState'

const CATCH_UP_KEY = 'catch-up'

function CatchUpDivider({ lapse }: { lapse: Option.Option<Lapse> }) {
  return (
    <div data-slot="catch-up-divider" className="flex items-center justify-center">
      <span className="border-primary/25 bg-background text-muted-foreground inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs whitespace-nowrap">
        <Laptop aria-hidden="true" className="text-primary size-3.5" />
        <span className="text-foreground font-semibold">On laptop</span>
        {Option.match(lapse, {
          onNone: () => null,
          onSome: (found) => (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[11px] tabular-nums">{lapseLabel(found)}</span>
            </>
          ),
        })}
      </span>
    </div>
  )
}

export function useCatchUp(
  view: Option.Option<TranscriptView>,
  rows: readonly ThreadRow[],
): readonly ThreadRow[] {
  const [phase, setPhase] = React.useState<CatchUp>(() => CatchUp.Waiting())
  const next = nextCatchUp(phase, view, rows)

  if (next !== phase) {
    setPhase(next)
  }

  const landed = React.useMemo(() => landedOf(next), [next])

  return React.useMemo(
    () =>
      Option.match(landed, {
        onNone: () => rows,
        onSome: (found) =>
          withCatchUpDivider(rows, found.keys, {
            key: CATCH_UP_KEY,
            content: <CatchUpDivider lapse={found.lapse} />,
          }),
      }),
    [rows, landed],
  )
}
