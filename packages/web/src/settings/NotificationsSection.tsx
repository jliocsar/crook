import { BellOff, Check, Send } from 'lucide-react'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import type * as React from 'react'

import type { NotificationSettings } from '@crook/domain/Notifications'
import { HarkNotConfigured } from '@crook/protocol/Hark'
import { failureMessage } from '@crook/web/atoms/ActionFailure'
import { ActionFailure } from '@crook/web/components/ActionFailure'
import { Dimmed } from '@crook/web/components/Dimmed'
import { Swap } from '@crook/web/components/Swap'
import { Button } from '@crook/web/components/ui/button'
import { Skeleton } from '@crook/web/components/ui/skeleton'
import { Spinner } from '@crook/web/components/ui/spinner'
import { useNotificationPref, useTestNotification } from '@crook/web/settings/SettingsActions'
import { NOTIFICATION_ROWS } from '@crook/web/settings/SettingsLayout'
import type {
  NotificationRow,
  SettingsReadFailure,
  TestNotificationState,
} from '@crook/web/settings/SettingsLayout'
import { SettingsNote, SettingsSection } from '@crook/web/settings/SettingsSection'
import { ToggleRow } from '@crook/web/settings/ToggleRow'

const SHARED_NOTE = 'Saved on the hub, so every device you log in on shares them.'

const PRIVACY_NOTE =
  'Notifications name the agent and the machine, never what Claude wrote. Hark delivers them, so they open nothing in crook.'

const NO_TOKEN_NOTE = `${new HarkNotConfigured().message} These switches are saved meanwhile, and apply once it has one.`

const TEST_LABEL = {
  idle: 'Send a test',
  sending: 'Sending',
  sent: 'Sent to your phone',
} satisfies Record<TestNotificationState, string>

const TEST_ICON = {
  idle: <Send />,
  sending: <Spinner />,
  sent: <Check />,
} satisfies Record<TestNotificationState, React.ReactNode>

function NotificationToggle({
  row,
  checked,
  controlsEnabled,
}: {
  row: NotificationRow
  checked: boolean
  controlsEnabled: boolean
}) {
  const pref = useNotificationPref(row.event)

  return (
    <ToggleRow
      label={row.label}
      detail={row.detail}
      checked={checked}
      disabled={!controlsEnabled}
      busy={pref.pending}
      failure={pref.failure}
      onChange={pref.write}
    />
  )
}

function NoTokenNotice() {
  return (
    <div
      role="note"
      data-slot="no-hark-token"
      className="border-border bg-muted/60 mx-4 mt-3 mb-1 flex gap-3 rounded-lg border px-3 py-2.5"
    >
      <BellOff aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm leading-5 font-medium">Notifications are off</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-4">{NO_TOKEN_NOTE}</p>
      </div>
    </div>
  )
}

function TogglesLoading() {
  return (
    <div aria-hidden="true" className="border-border border-t">
      {NOTIFICATION_ROWS.map((row) => (
        <div key={row.event} className="flex min-h-14 items-center gap-3 px-4 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-base leading-6">{row.label}</p>
            <p className="text-muted-foreground text-xs leading-4">{row.detail}</p>
          </div>
          <Skeleton className="h-7 w-12 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function NotificationToggles({
  settings,
  controlsEnabled,
  stale,
}: {
  settings: NotificationSettings
  controlsEnabled: boolean
  stale: boolean
}) {
  return (
    <Dimmed dimmed={stale} className="border-border border-t">
      {settings.delivery === 'noToken' ? <NoTokenNotice /> : null}
      <div>
        {NOTIFICATION_ROWS.map((row) => (
          <NotificationToggle
            key={row.event}
            row={row}
            checked={settings.prefs[row.event]}
            controlsEnabled={controlsEnabled}
          />
        ))}
      </div>
    </Dimmed>
  )
}

function TestNotification({ disabled }: { disabled: boolean }) {
  const test = useTestNotification()
  const unavailable = disabled || test.state === 'sending'

  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="px-4">
        <Button
          variant="secondary"
          size="touch"
          aria-disabled={unavailable}
          className="w-full text-base aria-disabled:pointer-events-none aria-disabled:opacity-60"
          onClick={() => {
            if (!unavailable) {
              test.send()
            }
          }}
        >
          <Swap id={test.state}>
            <span aria-hidden="true" className="inline-flex">
              {TEST_ICON[test.state]}
            </span>
            {TEST_LABEL[test.state]}
          </Swap>
        </Button>
        <span className="sr-only" aria-live="polite">
          {test.state === 'sent' ? 'Test notification sent' : ''}
        </span>
      </div>
      <ActionFailure className="px-4" message={test.failure} />
    </div>
  )
}

export function NotificationsSection({
  settings,
  controlsEnabled,
  stale,
}: {
  settings: AsyncResult.AsyncResult<NotificationSettings, SettingsReadFailure>
  controlsEnabled: boolean
  stale: boolean
}) {
  const current = AsyncResult.value(settings)
  const noToken = Option.exists(current, (known) => known.delivery === 'noToken')

  return (
    <SettingsSection title="Notifications">
      {Option.match(current, {
        onNone: () =>
          Option.match(failureMessage(settings), {
            onNone: () => <TogglesLoading />,
            onSome: (message) => <ActionFailure className="px-4" message={Option.some(message)} />,
          }),
        onSome: (known) => (
          <NotificationToggles settings={known} controlsEnabled={controlsEnabled} stale={stale} />
        ),
      })}
      <div className="grid grid-cols-1 gap-3 pt-3">
        <SettingsNote>{SHARED_NOTE}</SettingsNote>
        <TestNotification disabled={!controlsEnabled || noToken || Option.isNone(current)} />
        <SettingsNote>{PRIVACY_NOTE}</SettingsNote>
      </div>
    </SettingsSection>
  )
}
