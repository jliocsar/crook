import { useAtom } from '@effect/atom-react/Hooks'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { AnimatePresence, motion } from 'motion/react'
import * as React from 'react'

import { TOAST_DURATION, ToastIntent, toastAtom } from '@crook/web/atoms/Toast'
import type { Toast } from '@crook/web/atoms/Toast'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { translate, useTransformString } from '@crook/web/motion/TransformString'
import { COLUMN_STYLE } from '@crook/web/navigation/Column'

const TOAST_RISE_PX = 8

function ToastLine({ toast }: { toast: Option.Option<Toast> }) {
  const transform = useTransformString()

  return (
    <div
      role="status"
      data-slot="toast"
      className="pointer-events-none fixed bottom-[calc(var(--tab-bar-height)+var(--safe-bottom)+0.75rem)] z-40 flex justify-center px-4"
      style={COLUMN_STYLE}
    >
      <AnimatePresence initial={false}>
        {Option.match(toast, {
          onNone: () => null,
          onSome: (shown) => (
            <motion.div
              key={shown.id}
              className="bg-foreground text-background rounded-[1.125rem] px-4 py-2 text-sm leading-5 font-medium shadow-lg"
              initial={{ opacity: 0, transform: transform.translate('Y', TOAST_RISE_PX) }}
              animate={{ opacity: 1, transform: translate('Y', 0) }}
              exit={{ opacity: 0, transform: transform.translate('Y', TOAST_RISE_PX) }}
              transition={motionTokens().fade}
            >
              {shown.text}
            </motion.div>
          ),
        })}
      </AnimatePresence>
    </div>
  )
}

export function ToastHost() {
  const [toast, update] = useAtom(toastAtom)
  const shownId = Option.map(toast, (shown) => shown.id)

  React.useEffect(() => {
    if (Option.isNone(shownId)) {
      return undefined
    }

    const id = shownId.value

    return Effect.runCallback(
      Effect.sleep(TOAST_DURATION).pipe(
        Effect.andThen(
          Effect.sync(() => {
            update(ToastIntent.Expire({ id }))
          }),
        ),
      ),
    )
  }, [Option.getOrUndefined(shownId)])

  return <ToastLine toast={toast} />
}
