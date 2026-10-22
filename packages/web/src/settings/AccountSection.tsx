import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import { failureMessage } from '@crook/web/atoms/ActionFailure'
import type { HubAccount } from '@crook/protocol/ClientApi'
import { ActionFailure } from '@crook/web/components/ActionFailure'
import { InfoList } from '@crook/web/components/InfoList'
import { Sheet } from '@crook/web/components/Sheet'
import { Swap } from '@crook/web/components/Swap'
import { Button } from '@crook/web/components/ui/button'
import { Skeleton } from '@crook/web/components/ui/skeleton'
import { Spinner } from '@crook/web/components/ui/spinner'
import { useLogOut } from '@crook/web/settings/SettingsActions'
import type { SettingsReadFailure } from '@crook/web/settings/SettingsLayout'
import { SettingsNote, SettingsSection } from '@crook/web/settings/SettingsSection'

type LogOut = ReturnType<typeof useLogOut>

const LOST_PHONE_NOTE = 'Lost this phone? End its session on exe.dev from another device.'

const LOG_OUT_SCOPE_NOTE =
  "This ends crook's exe.dev session on this phone only. exe.dev itself stays signed in, so Log in with exe.dev may bring you straight back."

function AccountEmail({
  account,
}: {
  account: AsyncResult.AsyncResult<HubAccount, SettingsReadFailure>
}) {
  return Option.match(AsyncResult.value(account), {
    onNone: () =>
      Option.match(failureMessage(account), {
        onNone: () => (
          <span role="status" className="block">
            <span className="sr-only">Loading your account</span>
            <Skeleton className="ml-auto w-40" />
          </span>
        ),
        onSome: (message) => <span className="text-destructive font-sans">{message}</span>,
      }),
    onSome: (known) => known.email,
  })
}

function LogOutSheet({
  open,
  logOut,
  onClose,
}: {
  open: boolean
  logOut: LogOut
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Log out of crook?"
      description="Your agents keep running."
    >
      <div className="grid grid-cols-1 gap-2">
        <p className="text-muted-foreground pb-1 text-sm leading-5">{LOG_OUT_SCOPE_NOTE}</p>
        <ActionFailure className="pb-1" message={logOut.failure} />
        <Button
          variant="destructive"
          size="touch"
          className="text-base"
          aria-disabled={logOut.pending}
          onClick={() => {
            if (!logOut.pending) {
              logOut.logOut()
            }
          }}
        >
          <Swap id={logOut.pending ? 'pending' : 'idle'}>
            {logOut.pending ? <Spinner /> : null}
            {logOut.pending ? 'Logging out' : 'Log out'}
          </Swap>
        </Button>
        <Button variant="ghost" size="touch" className="text-base" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  )
}

export function AccountSection({
  account,
}: {
  account: AsyncResult.AsyncResult<HubAccount, SettingsReadFailure>
}) {
  const [confirming, setConfirming] = React.useState(false)
  const logOut = useLogOut()

  return (
    <SettingsSection title="Account">
      <div className="grid grid-cols-1 gap-3">
        <InfoList rows={[{ label: 'Logged in as', value: <AccountEmail account={account} /> }]} />
        <div className="px-4">
          <Button
            variant="destructive"
            size="touch"
            aria-haspopup="dialog"
            className="w-full text-base"
            onClick={() => {
              logOut.forgetSettled()
              setConfirming(true)
            }}
          >
            Log out
          </Button>
        </div>
        <SettingsNote>{LOST_PHONE_NOTE}</SettingsNote>
      </div>
      <LogOutSheet
        open={confirming}
        logOut={logOut}
        onClose={() => {
          setConfirming(false)
        }}
      />
    </SettingsSection>
  )
}
