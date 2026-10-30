import * as Arr from 'effect/Array'

import { Skeleton } from '@crook/web/components/ui/skeleton'

const SKELETON_SECTIONS = [3, 2] as const

function CardSkeleton() {
  return (
    <div
      data-slot="card-skeleton"
      className="bg-card grid grid-cols-1 gap-2 rounded-xl border px-3.5 pt-2.5 pb-3"
    >
      <Skeleton className="h-3 w-24" />
      <div className="flex items-center gap-2">
        <Skeleton className="size-5 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <Skeleton className="h-6 w-28 rounded-full" />
    </div>
  )
}

export function HerdSkeleton({ label }: { label: string }) {
  return (
    <div role="status" data-slot="herd-skeleton" className="grid grid-cols-1 gap-5 px-3 pt-2">
      <span className="sr-only">{label}</span>
      {SKELETON_SECTIONS.map((rows, section) => (
        <div key={section} className="grid grid-cols-1 gap-2">
          <Skeleton className="mx-1 mb-1 h-4 w-24" />
          {Arr.makeBy(rows, (row) => (
            <CardSkeleton key={row} />
          ))}
        </div>
      ))}
    </div>
  )
}
