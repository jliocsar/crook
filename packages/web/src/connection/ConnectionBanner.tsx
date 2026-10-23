import { useAtomValue } from '@effect/atom-react/Hooks'
import { cn } from 'cn'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import { Check, ServerOff, WifiOff } from 'lucide-react'
import type * as React from 'react'

import { connectionAtom } from '@crook/web/atoms/Connection'
import { Collapse } from '@crook/web/components/Collapse'
import { Swap } from '@crook/web/components/Swap'
import { Spinner } from '@crook/web/components/ui/spinner'
import { failedNotice } from '@crook/web/connection/ConnectionView'
import type { ConnectionNotice } from '@crook/web/connection/ConnectionView'
import { shortElapsed } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

const NOTICE_SPINNER_SIZE = 14
const JUST_NOW = Duration.minutes(1)

const TONE = {
  unreachable: 'bg-[color-mix(in_oklab,var(--destructive)_16%,var(--background))] text-foreground',
  offline: 'bg-foreground text-background',
  syncing: 'bg-muted text-muted-foreground',
  connecting: 'bg-muted text-muted-foreground',
  recovered: 'bg-accent text-accent-foreground',
} satisfies Record<ConnectionNotice, string>

const NOTICE_COPY = {
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

const NOTICE_ICON = {
  syncing: <Spinner size={NOTICE_SPINNER_SIZE} />,
  connecting: <Spinner size={NOTICE_SPINNER_SIZE} />,
  unreachable: <ServerOff aria-hidden="true" className="size-3.5 shrink-0" />,
  offline: <WifiOff aria-hidden="true" className="size-3.5 shrink-0" />,
  recovered: <Check aria-hidden="true" className="size-3.5 shrink-0" />,
} satisfies Record<ConnectionNotice, React.ReactNode>

function LastSynced({ at }: { at: DateTime.Utc }) {
  const now = useNow()
  const recent = Duration.isLessThan(DateTime.distance(at, now), JUST_NOW)

  return <>{recent ? 'Updated just now' : `Updated ${shortElapsed(now, at)} ago`}</>
}

export function HeaderBanner() {
  const { notice, syncedAt } = useAtomValue(connectionAtom)

  return (
    <Collapse open={Option.isSome(notice)}>
      {Option.match(notice, {
        onNone: () => null,
        onSome: (shown) => (
          <div
            data-slot="connection-banner"
            data-notice={shown}
            className={cn(
              'flex h-8 items-center gap-2 px-4 text-xs leading-4 font-medium transition-colors duration-(--motion) ease-(--ease-out)',
              TONE[shown],
            )}
          >
            {NOTICE_ICON[shown]}
            <Swap id={shown}>{NOTICE_COPY[shown].line}</Swap>
            {failedNotice(shown)
              ? Option.match(syncedAt, {
                  onNone: () => null,
                  onSome: (at) => (
                    <span className="ml-auto font-mono whitespace-nowrap opacity-70">
                      <LastSynced at={at} />
                    </span>
                  ),
                })
              : null}
          </div>
        ),
      })}
    </Collapse>
  )
}

export function ConnectionLiveRegion({ notice }: { notice: Option.Option<ConnectionNotice> }) {
  return (
    <span className="sr-only" role="status">
      {Option.match(notice, {
        onNone: () => '',
        onSome: (shown) => `${NOTICE_COPY[shown].title}. ${NOTICE_COPY[shown].detail}`,
      })}
    </span>
  )
}
