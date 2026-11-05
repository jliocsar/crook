import { isOffline } from '@crook/domain/Machine'
import type { Machine, MachineConnection } from '@crook/domain/Machine'
import { Swap } from '@crook/web/components/Swap'
import { Spinner } from '@crook/web/components/ui/spinner'
import { StatusPill } from '@crook/web/components/ui/status-pill'
import type { StatusTone } from '@crook/web/components/ui/status-pill'
import { shortElapsed } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

const RECONNECTING_SPINNER_SIZE = 11

const MACHINE_CONNECTION_TONE = {
  online: 'ok',
  reconnecting: 'warn',
  offline: 'idle',
} satisfies Record<MachineConnection, StatusTone>

export function MachineBadge({ machine, plain = false }: { machine: Machine; plain?: boolean }) {
  const now = useNow(isOffline(machine))

  return (
    <StatusPill tone={MACHINE_CONNECTION_TONE[machine.connection]} plain={plain}>
      <span className="inline-flex items-center gap-1.5">
        <Swap id={machine.connection}>
          {isOffline(machine)
            ? `offline · ${shortElapsed(now, machine.lastSeenAt)} ago`
            : machine.connection}
        </Swap>
        <Spinner pending={machine.connection === 'reconnecting'} size={RECONNECTING_SPINNER_SIZE} />
      </span>
    </StatusPill>
  )
}
