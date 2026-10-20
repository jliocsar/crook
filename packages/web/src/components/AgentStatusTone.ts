import type { AgentStatus } from '@crook/domain/AgentStatus'

import type { StatusTone } from '@/components/ui/status-pill'

export const AGENT_STATUS_TONE = {
  idle: 'idle',
  working: 'working',
  blocked: 'blocked',
  done: 'ok',
  unknown: 'unknown',
} satisfies Record<AgentStatus, StatusTone>
