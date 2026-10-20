import type { ConnectionNotice } from '@crook/web/connection/ConnectionView'

export const NOTICE_COPY = {
  syncing: { line: 'Syncing', title: 'Syncing', detail: 'Catching up with the hub.' },
  connecting: {
    line: 'Connecting to the hub',
    title: 'Connecting to the hub',
    detail: 'Your agents show up in a moment.',
  },
  unreachable: {
    line: "Can't reach the hub · retrying",
    title: "Can't reach the hub",
    detail: 'crook keeps retrying. Your agents keep running.',
  },
  offline: {
    line: "You're offline",
    title: "You're offline",
    detail: 'crook reconnects once your phone is back online.',
  },
  recovered: { line: 'Back online', title: 'Back online', detail: 'Everything is up to date.' },
} satisfies Record<
  ConnectionNotice,
  { readonly line: string; readonly title: string; readonly detail: string }
>
