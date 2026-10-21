import { Outlet } from '@tanstack/react-router'

import { AgentActions } from '@crook/web/actions/AgentActions'
import { COLUMN_MAX_WIDTH } from '@crook/web/navigation/Column'
import { ShellReadyProvider } from '@crook/web/navigation/ShellReady'
import { TabBar } from '@crook/web/navigation/TabBar'
import { ToastHost } from '@crook/web/toast/Toast'

export function Shell({ needsYou }: { needsYou: number }) {
  return (
    <ShellReadyProvider>
      <div className="mx-auto" style={{ maxWidth: COLUMN_MAX_WIDTH }}>
        <Outlet />
      </div>
      <TabBar needsYou={needsYou} />
      <ToastHost />
      <AgentActions />
    </ShellReadyProvider>
  )
}
