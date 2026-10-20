import * as Arr from 'effect/Array'

import { Skeleton } from '@crook/web/components/ui/skeleton'

const SKELETON_SECTIONS = [3, 2] as const

export function HerdSkeleton({ label }: { label: string }) {
  return (
    <div role="status" data-slot="herd-skeleton" className="grid grid-cols-1 gap-5 px-4 pt-2">
      <span className="sr-only">{label}</span>
      {SKELETON_SECTIONS.map((rows, section) => (
        <div key={section} className="grid grid-cols-1 gap-2">
          <Skeleton className="mb-1 h-3 w-24" />
          {Arr.makeBy(rows, (row) => (
            <Skeleton key={row} className="h-18 rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  )
}
