import { Switch } from '@base-ui/react/switch'
import type * as Option from 'effect/Option'
import * as React from 'react'

import { ActionFailure } from '@crook/web/components/ActionFailure'

export function ToggleRow({
  label,
  detail,
  checked,
  disabled,
  busy,
  failure,
  onChange,
}: {
  label: string
  detail: string
  checked: boolean
  disabled: boolean
  busy: boolean
  failure: Option.Option<string>
  onChange: (checked: boolean) => void
}) {
  const id = React.useId()
  const detailId = `${id}-detail`

  return (
    <div data-slot="toggle-row">
      <div className="flex min-h-14 items-center gap-3 px-4 py-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block text-base leading-6">
            {label}
          </label>
          <p id={detailId} className="text-muted-foreground text-xs leading-4">
            {detail}
          </p>
        </div>
        <Switch.Root
          id={id}
          checked={checked}
          disabled={disabled}
          readOnly={busy}
          aria-busy={busy}
          aria-describedby={detailId}
          onCheckedChange={onChange}
          className="bg-muted data-[checked]:bg-primary focus-visible:ring-ring/50 hit-area relative inline-flex h-7 w-12 shrink-0 touch-manipulation items-center rounded-full p-0.5 transition-colors duration-[var(--motion)] ease-[var(--ease-out)] outline-none focus-visible:ring-3 motion-reduce:transition-none"
        >
          <Switch.Thumb className="bg-background block size-6 rounded-full shadow-sm transition-transform duration-[var(--motion)] ease-[var(--ease-out)] data-[checked]:translate-x-5 motion-reduce:transition-none" />
        </Switch.Root>
      </div>
      <ActionFailure className="px-4" message={failure} />
    </div>
  )
}
