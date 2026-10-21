import { Dialog } from '@base-ui/react/dialog'
import { cn } from 'cn'
import * as Base64 from 'effect/encoding/Base64'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import { X } from 'lucide-react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import * as React from 'react'

import type { ImageBlock } from '@crook/domain/TranscriptMessage'
import { useZoom } from '@crook/web/chat/ImageZoom'
import { Button } from '@crook/web/components/ui/button'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { scale as scaleTo } from '@crook/web/motion/TransformString'

type ThumbPlace = 'tool' | 'message'

export type Picture = { readonly image: ImageBlock; readonly name: string }

type Opened = { readonly picture: Picture; readonly url: string; readonly opener: HTMLElement }

const ENTER_SCALE = 0.96
const CLOSE_ICON_CLASS = 'size-6'
const THUMB_HEIGHT = { tool: 96, message: 160 } satisfies Record<ThumbPlace, number>

const objectUrlOf = (image: ImageBlock): Option.Option<string> =>
  Result.match(Base64.decode(image.data), {
    onFailure: () => Option.none(),
    onSuccess: (bytes) =>
      Option.some(
        URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: image.mediaType })),
      ),
  })

const focusQuietly = (element: HTMLElement | null): boolean => {
  element?.focus({ preventScroll: true, focusVisible: false })

  return false
}

const useObjectUrl = (image: ImageBlock): Option.Option<string> => {
  const [url, setUrl] = React.useState<Option.Option<string>>(Option.none())

  React.useEffect(() => {
    const made = objectUrlOf(image)

    setUrl(made)

    return () => {
      if (Option.isSome(made)) {
        URL.revokeObjectURL(made.value)
      }
    }
  }, [image])

  return url
}

function ViewerLayer({ opened, onClose }: { opened: Opened; onClose: () => void }) {
  const present = useIsPresent()
  const close = React.useRef<HTMLButtonElement>(null)
  const zoom = useZoom(onClose)
  const reduce = useReducedMotion() ?? false

  return (
    <Dialog.Portal keepMounted>
      <Dialog.Popup
        initialFocus={(type) => type === 'keyboard' || focusQuietly(close.current)}
        finalFocus={(type) =>
          type === 'keyboard' || focusQuietly(opened.opener.isConnected ? opened.opener : null)
        }
        render={
          <motion.div
            className={cn(
              'fixed inset-0 z-50 text-white outline-none',
              !present && 'pointer-events-none',
            )}
            inert={!present}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTokens().fade}
          />
        }
      >
        <div ref={zoom.backdrop} className="absolute inset-0 bg-black" />
        <Dialog.Title className="sr-only">{opened.picture.name}</Dialog.Title>
        <Dialog.Description className="sr-only">
          Pinch or double-tap to zoom, swipe down to close.
        </Dialog.Description>
        <div
          ref={zoom.stage}
          data-slot="image-stage"
          className="absolute inset-0 flex touch-none items-center justify-center overflow-hidden select-none"
          {...zoom.handlers}
        >
          <motion.div
            className="flex size-full items-center justify-center"
            initial={{ opacity: 0, transform: scaleTo(reduce ? 1 : ENTER_SCALE) }}
            animate={{ opacity: 1, transform: scaleTo(1) }}
            transition={motionTokens().fade}
          >
            <img
              ref={zoom.picture}
              src={opened.url}
              alt={opened.picture.name}
              draggable={false}
              className="max-h-full max-w-full object-contain will-change-transform [-webkit-touch-callout:none]"
            />
          </motion.div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent px-2 pt-[var(--safe-top)] pb-6">
          <span className="min-w-0 flex-1 truncate ps-3 font-mono text-xs text-white/80">
            {opened.picture.name}
          </span>
          <Dialog.Close
            render={
              <Button
                ref={close}
                variant="ghost"
                size="icon-touch"
                aria-label="Close image"
                className="pointer-events-auto text-white hover:bg-white/15 hover:text-white"
              >
                <X className={CLOSE_ICON_CLASS} />
              </Button>
            }
          />
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  )
}

function Thumb({
  picture,
  height,
  onOpen,
}: {
  picture: Picture
  height: number
  onOpen: (url: string, opener: HTMLElement) => void
}) {
  const url = useObjectUrl(picture.image)

  return Option.match(url, {
    onNone: () => null,
    onSome: (href) => (
      <button
        type="button"
        aria-label={`View ${picture.name}`}
        className="border-border bg-muted focus-visible:ring-ring shrink-0 touch-manipulation overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
        onClick={(event) => {
          onOpen(href, event.currentTarget)
        }}
      >
        <img
          src={href}
          alt={picture.name}
          draggable={false}
          className="block w-auto max-w-[16rem] object-cover"
          style={{ height }}
        />
      </button>
    ),
  })
}

export function Thumbs({
  pictures,
  place,
  className,
}: {
  pictures: readonly Picture[]
  place: ThumbPlace
  className?: string
}) {
  const [opened, setOpened] = React.useState<Option.Option<Opened>>(Option.none())

  const close = () => {
    setOpened(Option.none())
  }

  if (pictures.length === 0) {
    return null
  }

  return (
    <>
      <div data-slot="thumbs" className={cn('no-scrollbar flex gap-2 overflow-x-auto', className)}>
        {pictures.map((picture, index) => (
          <Thumb
            key={index}
            picture={picture}
            height={THUMB_HEIGHT[place]}
            onOpen={(url, opener) => {
              setOpened(Option.some({ picture, url, opener }))
            }}
          />
        ))}
      </div>
      <Dialog.Root
        open={Option.isSome(opened)}
        onOpenChange={(next) => {
          if (!next) {
            close()
          }
        }}
      >
        <AnimatePresence>
          {Option.match(opened, {
            onNone: () => null,
            onSome: (current) => <ViewerLayer key={current.url} opened={current} onClose={close} />,
          })}
        </AnimatePresence>
      </Dialog.Root>
    </>
  )
}
