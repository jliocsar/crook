import { AnimatePresence, motion } from 'motion/react'

import { SpinnerGlyph } from '@crook/web/components/ui/spinner'
import { BannerRoom } from '@crook/web/connection/ConnectionBanner'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { translate, useTransformString } from '@crook/web/motion/TransformString'

const RISE = 8
const SPINNER_SIZE = 14
const CATCHING_UP = 'Catching up'

export function CatchingUpCapsule({ shown }: { shown: boolean }) {
  const transform = useTransformString()

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2">
      <span role="status" className="sr-only">
        {shown ? CATCHING_UP : ''}
      </span>
      <BannerRoom>
        <div className="flex justify-center">
          <AnimatePresence initial={false}>
            {shown ? (
              <motion.span
                key="catching-up"
                aria-hidden="true"
                data-slot="catching-up-capsule"
                className="border-border bg-card/90 text-muted-foreground inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-sm backdrop-blur"
                initial={{ opacity: 0, transform: transform.translate('Y', RISE) }}
                animate={{ opacity: 1, transform: translate('Y', 0) }}
                exit={motionTokens().exit}
                transition={motionTokens().fade}
              >
                <SpinnerGlyph size={SPINNER_SIZE} />
                {CATCHING_UP}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </BannerRoom>
    </div>
  )
}
