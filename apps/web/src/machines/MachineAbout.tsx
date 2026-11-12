import { InfoList } from '@crook/web/components/InfoList'
import { StatusPill } from '@crook/web/components/ui/status-pill'
import { aboutRows } from '@crook/web/machines/MachineLayout'
import type { InfoRow, MachineDetailModel } from '@crook/web/machines/MachineLayout'
import { SectionLabel } from '@crook/web/machines/SectionLabel'
import { useNow } from '@crook/web/time/Now'

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

export function MachineAbout({ detail }: { detail: MachineDetailModel }) {
  const now = useNow()

  return (
    <section aria-labelledby="machine-about">
      <SectionLabel id="machine-about">About</SectionLabel>
      <InfoList
        rows={aboutRows(detail, now).map((row) => ({
          label: row.label,
          value: <InfoValue row={row} />,
        }))}
      />
      {detail.card.behindHub ? (
        <p
          data-slot="agent-update-note"
          className="text-muted-foreground px-4 pt-2 text-xs leading-4"
        >
          {`To update it, run the crook plugin's "crook: update agent" action in herdr on ${detail.card.machine.label}, and enter ${detail.hubVersion}.`}
        </p>
      ) : null}
    </section>
  )
}
