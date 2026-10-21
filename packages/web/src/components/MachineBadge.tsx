import type * as DateTime from 'effect/DateTime'

import { isOffline } from '@crook/domain/Machine'
import type { Machine, MachineConnection } from '@crook/domain/Machine'
import { Swap } from '@crook/web/components/Swap'
import { Spinner } from '@crook/web/components/ui/spinner'
import { StatusPill } from '@crook/web/components/ui/status-pill'
import type { StatusTone } from '@crook/web/components/ui/status-pill'
import { shortElapsed } from '@crook/web/time/Elapsed'

const RECONNECTING_SPINNER_SIZE = 11

export const MACHINE_CONNECTION_TONE = {
  online: 'ok',
  reconnecting: 'warn',
  offline: 'idle',
} satisfies Record<MachineConnection, StatusTone>

export function MachineBadge({
  machine,
  now,
  plain = false,
}: {
  machine: Machine
  now: DateTime.Utc
  plain?: boolean
}) {
  return (
    <StatusPill tone={MACHINE_CONNECTION_TONE[machine.connection]} plain={plain}>
      <Swap id={machine.connection}>
        {isOffline(machine)
          ? `offline · ${shortElapsed(now, machine.lastSeenAt)} ago`
          : machine.connection}
        {machine.connection === 'reconnecting' ? (
          <Spinner size={RECONNECTING_SPINNER_SIZE} />
        ) : null}
      </Swap>
    </StatusPill>
  )
}
