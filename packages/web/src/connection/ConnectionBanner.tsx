import { cn } from 'cn'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import { Check, ServerOff, WifiOff } from 'lucide-react'

import { Collapse } from '@crook/web/components/Collapse'
import { Swap } from '@crook/web/components/Swap'
import { Spinner } from '@crook/web/components/ui/spinner'
import { useConnectionView } from '@crook/web/connection/ConnectionContext'
import { NOTICE_COPY } from '@crook/web/connection/ConnectionNotices'
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

function NoticeIcon({ notice }: { notice: ConnectionNotice }) {
  if (notice === 'syncing' || notice === 'connecting') {
    return <Spinner size={NOTICE_SPINNER_SIZE} />
  }

  if (notice === 'unreachable') {
    return <ServerOff aria-hidden="true" className="size-3.5 shrink-0" />
  }

  if (notice === 'offline') {
    return <WifiOff aria-hidden="true" className="size-3.5 shrink-0" />
  }

  return <Check aria-hidden="true" className="size-3.5 shrink-0" />
}

function LastSynced({ at }: { at: DateTime.Utc }) {
  const now = useNow()
  const recent = Duration.isLessThan(DateTime.distance(at, now), JUST_NOW)

  return <>{recent ? 'Updated just now' : `Updated ${shortElapsed(now, at)} ago`}</>
}

export function ConnectionBanner({
  notice,
  syncedAt,
}: {
  notice: Option.Option<ConnectionNotice>
  syncedAt: Option.Option<DateTime.Utc>
}) {
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
            <NoticeIcon notice={shown} />
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

export function HeaderBanner() {
  const { notice, syncedAt } = useConnectionView()

  return <ConnectionBanner notice={notice} syncedAt={syncedAt} />
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
