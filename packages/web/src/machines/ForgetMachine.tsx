import * as Option from 'effect/Option'

import { HoldButton } from '@crook/web/components/ui/hold-button'

export function ForgetMachine({
  label,
  controlsEnabled,
  failure,
  onForget,
}: {
  label: string
  controlsEnabled: boolean
  failure: Option.Option<string>
  onForget: () => void
}) {
  return (
    <div data-slot="forget-machine" className="grid gap-2 px-4">
      <HoldButton
        disabled={!controlsEnabled}
        className="w-full text-base"
        completeLabel="Forgotten"
        onComplete={onForget}
      >
        Hold to forget {label}
      </HoldButton>
      <p className="text-muted-foreground text-center text-xs leading-4">
        It comes back on its own if its agent connects again.
      </p>
      {Option.match(failure, {
        onNone: () => null,
        onSome: (message) => <ForgetFailure message={message} />,
      })}
    </div>
  )
}

export function ForgetFailure({ message }: { message: string }) {
  return (
    <p role="alert" className="text-destructive text-sm leading-5">
      {message}
    </p>
  )
}
