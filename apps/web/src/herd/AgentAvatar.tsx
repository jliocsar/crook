import { blobatar } from 'blobatar/blob'
import { cn } from 'cn'
import * as Option from 'effect/Option'
import { useMemo } from 'react'

import type { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { AgentStatusIcon } from '@crook/web/herd/AgentStatusIcon'

const AVATAR_SIZE = 40

export const agentAvatarSeed = (row: AgentRow): string =>
  Option.getOrElse(row.label, () => row.pane)

function Blob({ seed, kept }: { seed: string; kept: boolean }) {
  const markup = useMemo(() => blobatar(seed, { size: AVATAR_SIZE, background: 'circle' }), [seed])

  return (
    <span
      data-slot="agent-blob"
      className={cn(
        'block size-10 transition-[filter] duration-(--motion) ease-(--ease-out) [&>svg]:block',
        kept && 'grayscale',
      )}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}

export function AgentAvatar({
  row,
  status,
  kept,
}: {
  row: AgentRow
  status: AgentStatus
  kept: boolean
}) {
  return (
    <span aria-hidden="true" data-slot="agent-avatar" className="relative shrink-0">
      <Blob seed={agentAvatarSeed(row)} kept={kept} />
      <span className="bg-card absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full">
        <AgentStatusIcon status={status} still={kept} sizeClass="size-3.5" />
      </span>
    </span>
  )
}
