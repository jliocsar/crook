import type * as DateTime from 'effect/DateTime'

import { InfoList } from '@crook/web/components/InfoList'
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
      <InfoList
        rows={aboutRows(detail, now).map((row) => ({
          label: row.label,
          value: <InfoValue row={row} />,
        }))}
      />
    </section>
  )
}
