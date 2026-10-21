import type * as DateTime from 'effect/DateTime'

import { StatusPill } from '@crook/web/components/ui/status-pill'
import { aboutRows } from '@crook/web/machines/MachineLayout'
import type { InfoRow, MachineDetailModel } from '@crook/web/machines/MachineLayout'
import { SectionLabel } from '@crook/web/machines/SectionLabel'

function InfoValue({ row }: { row: InfoRow }) {
  if (!row.warn) {
    return row.value
  }

  return (
    <StatusPill tone="warn" plain className="text-foreground text-sm">
      {row.value}
    </StatusPill>
  )
}

export function MachineAbout({ detail, now }: { detail: MachineDetailModel; now: DateTime.Utc }) {
  return (
    <section aria-labelledby="machine-about">
      <SectionLabel id="machine-about">About</SectionLabel>
      <dl className="border-border border-t">
        {aboutRows(detail, now).map((row) => (
          <div
            key={row.label}
            className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5"
          >
            <dt className="text-muted-foreground shrink-0 text-sm">{row.label}</dt>
            <dd className="min-w-0 text-right font-mono text-sm break-words">
              <InfoValue row={row} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
