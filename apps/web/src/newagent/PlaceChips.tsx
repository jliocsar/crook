import { cn } from 'cn'
import * as Option from 'effect/Option'
import { ChevronDown, Folder, GitBranch, Server } from 'lucide-react'
import type * as React from 'react'

import type { NewAgentChips } from '@crook/web/newagent/NewAgentLayout'

export type Picker = 'machine' | 'folder' | 'branch'

function Chip({
  icon,
  role,
  label,
  accent = false,
  onClick,
}: {
  icon: React.ReactNode
  role: string
  label: string
  accent?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      data-slot="place-chip"
      onClick={onClick}
      className={cn(
        'border-border hover:bg-muted focus-visible:ring-ring/50 inline-flex h-11 max-w-full shrink-0 touch-manipulation items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] outline-none select-none focus-visible:ring-3 disabled:opacity-50 motion-reduce:transition-none',
        accent && 'border-primary/50 text-primary',
      )}
    >
      <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="sr-only">{role}, </span>
      <span className="truncate">{label}</span>
      <ChevronDown aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
    </button>
  )
}

export function PlaceChips({
  chips,
  onOpen,
}: {
  chips: NewAgentChips
  onOpen: (picker: Picker) => void
}) {
  return (
    <div className="no-scrollbar -mx-4 -my-1 flex gap-2 overflow-x-auto px-4 py-1">
      <Chip
        icon={<Server />}
        role="Machine"
        label={chips.machine}
        onClick={() => {
          onOpen('machine')
        }}
      />
      <Chip
        icon={<Folder />}
        role="Folder"
        label={Option.getOrElse(chips.folder, () => 'Pick a folder')}
        accent={Option.isNone(chips.folder)}
        onClick={() => {
          onOpen('folder')
        }}
      />
      {Option.match(chips.branch, {
        onNone: () => null,
        onSome: (branch) => (
          <Chip
            icon={<GitBranch />}
            role="Branch"
            label={branch.label}
            accent={branch.isNew}
            onClick={() => {
              onOpen('branch')
            }}
          />
        ),
      })}
    </div>
  )
}
