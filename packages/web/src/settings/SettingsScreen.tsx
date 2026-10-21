import { useAtomValue } from '@effect/atom-react/Hooks'

import { connectionAtom } from '@crook/web/atoms/Connection'
import { accountAtom, hubVersionAtom, notificationSettingsAtom } from '@crook/web/atoms/Settings'
import { TabScreen } from '@crook/web/navigation/TabScreen'
import { AccountSection } from '@crook/web/settings/AccountSection'
import { HubSection } from '@crook/web/settings/HubSection'
import { NotificationsSection } from '@crook/web/settings/NotificationsSection'
import { hubStatus } from '@crook/web/settings/SettingsLayout'

export function SettingsScreen() {
  const connection = useAtomValue(connectionAtom)
  const settings = useAtomValue(notificationSettingsAtom)
  const account = useAtomValue(accountAtom)
  const version = useAtomValue(hubVersionAtom)

  return (
    <TabScreen title="Settings">
      <div className="grid grid-cols-1 gap-8 pt-2">
        <NotificationsSection
          settings={settings}
          controlsEnabled={connection.controlsEnabled}
          stale={connection.stale}
        />
        <AccountSection account={account} />
        <HubSection
          status={hubStatus(connection)}
          address={window.location.host}
          version={version}
        />
      </div>
    </TabScreen>
  )
}
