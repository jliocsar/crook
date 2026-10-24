import type { AgentStatus } from '@crook/domain/AgentStatus'

import { StatusDot } from '@crook/web/components/StatusDot'
import { Swap } from '@crook/web/components/Swap'

export const STATUS_WORD = {
  idle: 'idle',
  working: 'working',
  blocked: 'needs you',
  done: 'done',
  unknown: 'unknown',
} satisfies Record<AgentStatus, string>

export function StatusWord({ status, className }: { status: AgentStatus; className?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <StatusDot status={status} />
      <Swap id={status} className={className}>
        {STATUS_WORD[status]}
      </Swap>
    </span>
  )
}
