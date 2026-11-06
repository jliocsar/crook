import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import { failureMessage } from '@crook/web/atoms/ActionFailure'
import type { HubAccount } from '@crook/protocol/ClientApi'
import { failureNotice, FloatingNotices } from '@crook/web/components/FloatingNotices'
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

const ACCOUNT_UNAVAILABLE = 'Shows once crook reconnects'
const ACCOUNT_FAILED = 'Could not load'
const LOST_PHONE_NOTE = 'Lost this phone? End its session on exe.dev from another device.'

const LOG_OUT_SCOPE_NOTE =
  "This ends crook's exe.dev session on this phone only. exe.dev itself stays signed in, so Log in with exe.dev may bring you straight back."

function AccountEmail({
  account,
  unavailable,
}: {
  account: AsyncResult.AsyncResult<HubAccount, SettingsReadFailure>
  unavailable: boolean
}) {
  return Option.match(AsyncResult.value(account), {
    onNone: () =>
      Option.match(failureMessage(account), {
        onNone: () =>
          unavailable ? (
            <span className="text-muted-foreground font-sans">{ACCOUNT_UNAVAILABLE}</span>
          ) : (
            <span role="status" className="block">
              <span className="sr-only">Loading your account</span>
              <Skeleton className="ml-auto w-40" />
            </span>
          ),
        onSome: () => <span className="text-muted-foreground font-sans">{ACCOUNT_FAILED}</span>,
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
        <FloatingNotices notices={Option.toArray(failureNotice('log-out', logOut.failure))} />
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
          <span className="inline-flex items-center gap-1.5">
            <Spinner pending={logOut.pending} />
            <Swap id={logOut.pending ? 'pending' : 'idle'}>
              {logOut.pending ? 'Logging out' : 'Log out'}
            </Swap>
          </span>
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
  unavailable,
}: {
  unavailable: boolean
  account: AsyncResult.AsyncResult<HubAccount, SettingsReadFailure>
}) {
  const [confirming, setConfirming] = React.useState(false)
  const logOut = useLogOut()

  return (
    <SettingsSection title="Account">
      <div className="grid grid-cols-1 gap-3">
        <InfoList
          rows={[
            {
              label: 'Logged in as',
              value: <AccountEmail account={account} unavailable={unavailable} />,
            },
          ]}
        />
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
