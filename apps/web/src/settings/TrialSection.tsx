import * as Option from 'effect/Option'

import { setNativeThread, useNativeThread } from '@crook/web/chat/ThreadTrial'
import { SettingsSection } from '@crook/web/settings/SettingsSection'
import { ToggleRow } from '@crook/web/settings/ToggleRow'

export function TrialSection() {
  const native = useNativeThread()

  return (
    <SettingsSection title="Trial">
      <ToggleRow
        label="New chat scrolling"
        detail="The browser keeps a chat at its end, with no glide. On this phone only."
        checked={native}
        disabled={false}
        busy={false}
        failure={Option.none()}
        onChange={setNativeThread}
      />
    </SettingsSection>
  )
}
