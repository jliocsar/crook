import type { AgentStatus } from '@crook/domain/AgentStatus'

import { StatusDot } from '@crook/web/components/StatusDot'
import { Swap } from '@crook/web/components/Swap'

export function StatusWord({ status, className }: { status: AgentStatus; className?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <StatusDot status={status} />
      <Swap id={status} className={className}>
        {status}
      </Swap>
    </span>
  )
}
