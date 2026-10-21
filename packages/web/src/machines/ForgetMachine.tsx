import * as Option from 'effect/Option'

import { FailureNote } from '@crook/web/components/FailureNote'
import { HoldButton } from '@crook/web/components/ui/hold-button'

export function ForgetMachine({
  label,
  disabled,
  failure,
  onForget,
}: {
  label: string
  disabled: boolean
  failure: Option.Option<string>
  onForget: () => void
}) {
  return (
    <div data-slot="forget-machine" className="grid gap-2 px-4">
      <HoldButton
        disabled={disabled}
        className="w-full text-base"
        completeLabel="Forgetting…"
        onComplete={onForget}
      >
        Hold to forget {label}
      </HoldButton>
      <p className="text-muted-foreground text-center text-xs leading-4">
        It comes back on its own if its agent connects again.
      </p>
      {Option.match(failure, {
        onNone: () => null,
        onSome: (message) => <FailureNote message={message} />,
      })}
    </div>
  )
}
