import { cn } from 'cn'
import * as Option from 'effect/Option'
import { AnimatePresence, motion } from 'motion/react'
import type * as React from 'react'

import { motionTokens } from '@crook/web/motion/MotionTokens'
import { translate, useTransformString } from '@crook/web/motion/TransformString'

export interface FloatingNotice {
  readonly id: string
  readonly tone: 'failure' | 'quiet'
  readonly text: string
  readonly slot?: string
  readonly action?: React.ReactNode
}

const NOTICE_RISE_PX = 8

export const failureNotice = (
  id: string,
  failure: Option.Option<string>,
): Option.Option<FloatingNotice> =>
  Option.map(failure, (text): FloatingNotice => ({ id, tone: 'failure', text }))

export function FloatingNotices({ notices }: { notices: readonly FloatingNotice[] }) {
  const transform = useTransformString()

  return (
    <div
      data-slot="floating-notices"
      className="pointer-events-none absolute inset-x-3 bottom-full z-20 mb-2 flex flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <motion.div
            key={notice.id}
            className="border-border bg-card pointer-events-auto grid gap-1 rounded-xl border px-3 py-2 shadow-md"
            initial={{ opacity: 0, transform: transform.translate('Y', NOTICE_RISE_PX) }}
            animate={{ opacity: 1, transform: translate('Y', 0) }}
            exit={{ opacity: 0, transform: transform.translate('Y', NOTICE_RISE_PX) }}
            transition={motionTokens().fade}
          >
            <p
              data-slot={notice.slot}
              role={notice.tone === 'failure' ? 'alert' : 'status'}
              className={cn(
                'text-sm leading-5',
                notice.tone === 'failure' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {notice.text}
            </p>
            {notice.action}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
