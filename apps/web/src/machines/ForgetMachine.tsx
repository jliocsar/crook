import type * as Option from 'effect/Option'

import { ActionFailure } from '@crook/web/components/ActionFailure'
import { HoldButton } from '@crook/web/components/ui/hold-button'

export function ForgetMachine({
  label,
  disabled,
  pending,
  failure,
  onForget,
}: {
  label: string
  disabled: boolean
  pending: boolean
  failure: Option.Option<string>
  onForget: () => void
}) {
  return (
    <div data-slot="forget-machine" className="grid gap-2 px-4">
      <HoldButton
        disabled={disabled}
        className="w-full text-base"
        pending={pending}
        pendingLabel="Forgetting…"
        onComplete={onForget}
      >
        Hold to forget {label}
      </HoldButton>
      <p className="text-muted-foreground text-center text-xs leading-4">
        It comes back on its own if its agent connects again.
      </p>
      <ActionFailure message={failure} />
    </div>
  )
}
