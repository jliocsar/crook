import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import type { HubAccount } from '@crook/protocol/ClientApi'
import { InfoList } from '@crook/web/components/InfoList'
import { Sheet } from '@crook/web/components/Sheet'
import { Swap } from '@crook/web/components/Swap'
import { Button } from '@crook/web/components/ui/button'
import { Skeleton } from '@crook/web/components/ui/skeleton'
import { Spinner } from '@crook/web/components/ui/spinner'
import { useLogOut } from '@crook/web/settings/SettingsActions'
import { settledFailure } from '@crook/web/settings/SettingsLayout'
import type { SettingsReadFailure } from '@crook/web/settings/SettingsLayout'
import { SettingsNote, SettingsSection } from '@crook/web/settings/SettingsSection'

const LOST_PHONE_NOTE = 'Lost this phone? End its session on exe.dev from another device.'

function AccountEmail({
  account,
}: {
  account: AsyncResult.AsyncResult<HubAccount, SettingsReadFailure>
}) {
  return Option.match(AsyncResult.value(account), {
    onNone: () =>
      Option.match(settledFailure(account), {
        onNone: () => <Skeleton className="ml-auto w-40" />,
        onSome: (message) => <span className="text-destructive font-sans">{message}</span>,
      }),
    onSome: (known) => known.email,
  })
}

function LogOutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const logOut = useLogOut()

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Log out of crook?"
      description="Your agents keep running."
    >
      <div className="grid grid-cols-1 gap-2">
        {Option.match(logOut.failure, {
          onNone: () => null,
          onSome: (message) => (
            <p role="alert" className="text-destructive pb-1 text-sm leading-5">
              {message}
            </p>
          ),
        })}
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
            {logOut.pending ? <Spinner size={16} /> : null}
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
        onClose={() => {
          setConfirming(false)
        }}
      />
    </SettingsSection>
  )
}
