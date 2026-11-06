import * as DateTime from 'effect/DateTime'
import { constVoid } from 'effect/Function'
import * as Option from 'effect/Option'
import * as React from 'react'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { MachineId } from '@crook/domain/Ids'
import { Machine } from '@crook/domain/Machine'
import { MeasuredSkeleton } from '@crook/web/components/MeasuredSkeleton'
import { MachineList } from '@crook/web/machines/MachineList'
import type { MachineCardModel, MachinesLayout } from '@crook/web/machines/MachineLayout'
import { FrozenScope } from '@crook/web/navigation/Covered'

const SAMPLE_AGENT_VERSION = CrookVersion.make('0.1.0')
const SAMPLE_HERDR_VERSION = '0.9.5'

const sampleMachine = (now: DateTime.Utc, id: string, label: string): MachineCardModel => ({
  machine: new Machine({
    id: MachineId.make(id),
    label,
    connection: 'online',
    connectionChangedAt: now,
    lastSeenAt: now,
    agentVersion: Option.some(SAMPLE_AGENT_VERSION),
    herdrVersion: Option.some(SAMPLE_HERDR_VERSION),
  }),
  agents: 2,
  needsYou: 0,
  behindHub: false,
  herdrLostAt: Option.none(),
})

const sampleMachines = (now: DateTime.Utc): MachinesLayout => ({
  machines: [
    sampleMachine(now, 'sample-one', 'machine'),
    sampleMachine(now, 'sample-two', 'other machine'),
    sampleMachine(now, 'sample-three', 'one more'),
  ],
})

export function MachinesSkeleton() {
  const [layout] = React.useState(() => sampleMachines(DateTime.nowUnsafe()))

  return (
    <MeasuredSkeleton slot="machines-skeleton" label="Loading your machines">
      <FrozenScope>
        <MachineList layout={layout} controlsEnabled={false} onOpen={constVoid} />
      </FrozenScope>
    </MeasuredSkeleton>
  )
}
