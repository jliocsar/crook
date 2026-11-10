import { Dialog } from '@base-ui/react/dialog'
import { cn } from 'cn'
import { AnimatePresence, motion, useDragControls, useIsPresent } from 'motion/react'
import * as React from 'react'

import { SWIPE_DISMISS_DISTANCE, SWIPE_DISMISS_VELOCITY } from '@crook/web/components/SwipeDismiss'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { GLIDE } from '@crook/web/motion/Springs'
import { COLUMN_STYLE } from '@crook/web/navigation/Column'
import { focusTarget } from '@crook/web/navigation/Focus'

const SHEET_ELASTIC_ABOVE = 0.05

function SheetLayer({
  onClose,
  openerGone,
  title,
  description,
  children,
}: {
  onClose: () => void
  openerGone: boolean
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
}) {
  const drag = useDragControls()
  const handle = React.useRef<HTMLDivElement>(null)
  const present = useIsPresent()
  const [opener] = React.useState(() => document.activeElement)

  return (
    <Dialog.Portal keepMounted>
      <Dialog.Backdrop
        render={
          <motion.div
            data-slot="sheet-backdrop"
            className={cn('fixed inset-0 z-40 bg-black/40', !present && 'pointer-events-none')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTokens().fade}
          />
        }
      />
      <Dialog.Popup
        initialFocus={handle}
        finalFocus={() => focusTarget(openerGone ? null : opener)}
        render={
          <motion.div
            data-slot="sheet"
            className={cn(
              'bg-card text-card-foreground border-border fixed bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t outline-none',
              !present && 'pointer-events-none',
            )}
            inert={!present}
            style={COLUMN_STYLE}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={GLIDE}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: SHEET_ELASTIC_ABOVE, bottom: 1 }}
            onDragEnd={(_event, info) => {
              if (
                info.offset.y > SWIPE_DISMISS_DISTANCE ||
                info.velocity.y > SWIPE_DISMISS_VELOCITY
              ) {
                onClose()
              }
            }}
          />
        }
      >
        <div className="min-h-0 overflow-y-auto rounded-t-2xl px-4 pb-[max(1rem,var(--safe-bottom))]">
          <div
            ref={handle}
            tabIndex={-1}
            data-slot="sheet-handle"
            className="cursor-grab touch-none pt-2 pb-1 outline-none"
            onPointerDown={(event) => {
              drag.start(event)
            }}
          >
            <div
              aria-hidden="true"
              className="bg-muted-foreground/30 mx-auto mb-3 h-1 w-9 rounded-full"
            />
            <Dialog.Title className="font-display truncate text-xl leading-7 font-semibold tracking-[-0.015em]">
              {title}
            </Dialog.Title>
            {description === undefined ? null : (
              <Dialog.Description className="text-muted-foreground mt-0.5 truncate text-sm">
                {description}
              </Dialog.Description>
            )}
          </div>
          <div className="mt-3">{children}</div>
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  )
}

export function Sheet({
  open,
  onClose,
  openerGone = false,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  openerGone?: boolean
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose()
        }
      }}
    >
      <AnimatePresence>
        {open ? (
          <SheetLayer
            key="sheet"
            onClose={onClose}
            openerGone={openerGone}
            title={title}
            description={description}
          >
            {children}
          </SheetLayer>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}
