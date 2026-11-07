import { Outlet } from '@tanstack/react-router'
import * as React from 'react'

import { BannerRoom, HeaderBanner } from '@crook/web/connection/ConnectionBanner'
import { coverPhaseOf, CoveredScope, PushedPositionContext } from '@crook/web/navigation/Covered'
import type { PushedPosition } from '@crook/web/navigation/Covered'
import { useCoveredByPushedScreen } from '@crook/web/navigation/Pushed'

export const TAB_SCROLLER_SELECTOR = '[data-slot="tab-scroller"]'

export function TabHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="bg-background/90 sticky top-0 z-10 pt-[var(--safe-top)] backdrop-blur">
      <HeaderBanner />
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <h1 className="font-display text-2xl leading-8 font-bold tracking-[-0.025em]">{title}</h1>
        {action}
      </div>
    </header>
  )
}

export function TabScreen({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children?: React.ReactNode
}) {
  const covered = useCoveredByPushedScreen()
  const [position, setPosition] = React.useState<PushedPosition>('arriving')

  return (
    <>
      <div
        inert={covered}
        data-slot="tab-scroller"
        className="no-scrollbar h-dvh overflow-y-auto overscroll-y-none pb-[calc(var(--tab-bar-height)+var(--safe-bottom)+1rem)]"
      >
        <CoveredScope phase={coverPhaseOf(covered, position)}>
          <TabHeader title={title} action={action} />
          <BannerRoom>{children}</BannerRoom>
        </CoveredScope>
      </div>
      <PushedPositionContext value={setPosition}>
        <Outlet />
      </PushedPositionContext>
    </>
  )
}
