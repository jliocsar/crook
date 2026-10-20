import { Outlet } from '@tanstack/react-router'
import type * as React from 'react'

import { useCoveredByPushedScreen } from '@/navigation/Pushed'

export function TabHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="bg-background/90 sticky top-0 z-10 px-4 pt-[var(--safe-top)] backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-2">
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

  return (
    <>
      <div
        inert={covered}
        className="no-scrollbar h-dvh overflow-y-auto pb-[calc(3.5rem+var(--safe-bottom)+1rem)]"
      >
        <TabHeader title={title} action={action} />
        {children}
      </div>
      <Outlet />
    </>
  )
}
