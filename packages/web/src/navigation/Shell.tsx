import { Outlet } from '@tanstack/react-router'

import { COLUMN_MAX_WIDTH } from '@crook/web/navigation/Column'
import { ShellReadyProvider } from '@crook/web/navigation/ShellReady'
import { TabBar } from '@crook/web/navigation/TabBar'

export function Shell({ needsYou = 0 }: { needsYou?: number }) {
  return (
    <ShellReadyProvider>
      <div className="mx-auto" style={{ maxWidth: COLUMN_MAX_WIDTH }}>
        <Outlet />
      </div>
      <TabBar needsYou={needsYou} />
    </ShellReadyProvider>
  )
}
