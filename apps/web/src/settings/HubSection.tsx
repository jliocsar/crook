import * as Option from 'effect/Option'

import type { CrookVersion } from '@crook/domain/CrookVersion'
import { InfoList } from '@crook/web/components/InfoList'
import { Skeleton } from '@crook/web/components/ui/skeleton'
import { StatusPill } from '@crook/web/components/ui/status-pill'
import type { HubStatus } from '@crook/web/settings/SettingsLayout'
import { SettingsSection } from '@crook/web/settings/SettingsSection'

const VERSION_UNAVAILABLE = 'Shows once crook reconnects'

export function HubSection({
  status,
  address,
  version,
  unavailable,
}: {
  status: HubStatus
  address: string
  version: Option.Option<CrookVersion>
  unavailable: boolean
}) {
  return (
    <SettingsSection title="Hub">
      <InfoList
        rows={[
          {
            label: 'Status',
            value: (
              <StatusPill tone={status.tone} plain className="font-sans">
                {status.label}
              </StatusPill>
            ),
          },
          { label: 'Address', value: address },
          {
            label: 'Version',
            value: Option.match(version, {
              onNone: () =>
                unavailable ? (
                  <span className="text-muted-foreground font-sans">{VERSION_UNAVAILABLE}</span>
                ) : (
                  <Skeleton className="ml-auto w-12" />
                ),
              onSome: (known) => known,
            }),
          },
        ]}
      />
    </SettingsSection>
  )
}
