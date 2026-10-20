import { Outlet } from '@tanstack/react-router'

import { COLUMN_MAX_WIDTH } from '@/navigation/Column'
import { ShellReadyProvider } from '@/navigation/ShellReady'
import { TabBar } from '@/navigation/TabBar'

export function Shell() {
  return (
    <ShellReadyProvider>
      <div className="mx-auto" style={{ maxWidth: COLUMN_MAX_WIDTH }}>
        <Outlet />
      </div>
      <TabBar />
    </ShellReadyProvider>
  )
}
