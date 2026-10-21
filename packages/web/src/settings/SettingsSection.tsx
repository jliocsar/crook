import * as React from 'react'

import { SectionLabel } from '@crook/web/machines/SectionLabel'

export function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  const id = React.useId()

  return (
    <section aria-labelledby={id}>
      <SectionLabel id={id}>{title}</SectionLabel>
      {children}
    </section>
  )
}

export function SettingsNote({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-4 text-xs leading-4">{children}</p>
}

export function SettingsFailure({ message }: { message: string }) {
  return (
    <p role="alert" className="text-destructive px-4 text-sm leading-5">
      {message}
    </p>
  )
}
