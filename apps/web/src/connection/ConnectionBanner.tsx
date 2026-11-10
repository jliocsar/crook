import { cn } from 'cn'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import { Check, ServerOff, WifiOff } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type * as React from 'react'

import { useAtomValue } from '@effect/atom-react/Hooks'

import { connectionAtom, linkMarkAtom } from '@crook/web/atoms/Connection'
import { Swap } from '@crook/web/components/Swap'
import { SpinnerGlyph } from '@crook/web/components/ui/spinner'
import { noticeOf, syncedAtOf } from '@crook/web/connection/ConnectionView'
import type { ConnectionNotice } from '@crook/web/connection/ConnectionView'
import { INSTANT, SPRING } from '@crook/web/motion/Springs'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { translate, useTransformString } from '@crook/web/motion/TransformString'
import {
  StillUnderCover,
  useIsStillUnderCover,
  useShownAtomValue,
} from '@crook/web/navigation/Covered'
import { shortElapsed } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

const NOTICE_SPINNER_SIZE = 14
const JUST_NOW = Duration.minutes(1)
const BANNER_HEIGHT_PX = 32

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
  syncing: <SpinnerGlyph size={NOTICE_SPINNER_SIZE} />,
  connecting: <SpinnerGlyph size={NOTICE_SPINNER_SIZE} />,
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
  const connection = useShownAtomValue(connectionAtom)
  const notice = noticeOf(connection)
  const transform = useTransformString()

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-full overflow-hidden"
      style={{ height: BANNER_HEIGHT_PX }}
    >
      <StillUnderCover>
        <AnimatePresence initial={false}>
          {Option.match(notice, {
            onNone: () => null,
            onSome: (shown) => (
              <motion.div
                key="banner"
                data-slot="connection-banner"
                data-notice={shown}
                className={cn(
                  'flex h-full items-center gap-2 px-4 text-xs leading-4 font-medium transition-colors duration-(--motion) ease-(--ease-out)',
                  TONE[shown],
                )}
                initial={{ opacity: 0, transform: transform.translate('Y', -BANNER_HEIGHT_PX) }}
                animate={{ opacity: 1, transform: translate('Y', 0) }}
                exit={{ opacity: 0, transform: transform.translate('Y', -BANNER_HEIGHT_PX) }}
                transition={motionTokens().fade}
              >
                {NOTICE_ICON[shown]}
                <Swap id={shown}>{NOTICE_COPY[shown].line}</Swap>
                {Option.match(syncedAtOf(connection), {
                  onNone: () => null,
                  onSome: (at) => (
                    <span className="ml-auto font-mono whitespace-nowrap opacity-70">
                      <LastSynced at={at} />
                    </span>
                  ),
                })}
              </motion.div>
            ),
          })}
        </AnimatePresence>
      </StillUnderCover>
    </div>
  )
}

export function BannerRoom({ children }: { children: React.ReactNode }) {
  const connection = useShownAtomValue(connectionAtom)
  const reduce = useReducedMotion() ?? false
  const still = useIsStillUnderCover()

  return (
    <motion.div
      initial={false}
      animate={{ y: Option.isSome(noticeOf(connection)) ? BANNER_HEIGHT_PX : 0 }}
      transition={reduce || still ? INSTANT : SPRING}
    >
      {children}
    </motion.div>
  )
}

export function ConnectionLiveRegion() {
  const connection = useAtomValue(connectionAtom)
  const mark = useAtomValue(linkMarkAtom)

  return (
    <span className="sr-only" role="status" {...mark}>
      {Option.match(noticeOf(connection), {
        onNone: () => '',
        onSome: (shown) => `${NOTICE_COPY[shown].title}. ${NOTICE_COPY[shown].detail}`,
      })}
    </span>
  )
}
