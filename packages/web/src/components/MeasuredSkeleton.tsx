import * as React from 'react'
import { Ghost } from 'skullet/internal'

const SAMPLE_PANE = { 'skullet-ghost': '' }

export function MeasuredSkeleton({
  slot,
  label,
  className,
  children,
}: {
  slot: string
  label: string
  className?: string
  children: React.ReactNode
}) {
  const root = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    if (root.current === null) {
      return undefined
    }

    const ghost = new Ghost(root.current, { exact: true })

    return () => {
      ghost.destroy()
    }
  }, [])

  return (
    <div role="status" data-slot={slot} className={className}>
      <span className="sr-only">{label}</span>
      <div ref={root} aria-hidden="true" inert>
        <div {...SAMPLE_PANE}>{children}</div>
      </div>
    </div>
  )
}
