import * as Arr from 'effect/Array'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import './KitchenPicker.css'

export interface KitchenPickerProps {
  readonly names: readonly string[]
  readonly active: number
  readonly hasReplay: boolean
  readonly position: 'bottom' | 'top'
  readonly onSelect: (index: number) => void
  readonly onReplay: () => void
}

const REPLAY_MARK = '↻'

export function KitchenPicker({
  names,
  active,
  hasReplay,
  position,
  onSelect,
  onReplay,
}: KitchenPickerProps) {
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const [highlight, setHighlight] = useState({ width: 0, offset: 0 })
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const measure = () => {
      const item = items.current[active]

      setHighlight({ width: item?.offsetWidth ?? 0, offset: item?.offsetLeft ?? 0 })
    }

    measure()
    window.addEventListener('resize', measure)

    return () => {
      window.removeEventListener('resize', measure)
    }
  }, [active, names])

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setReady(true)
      })
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [])

  return createPortal(
    <nav
      className="proto-picker"
      aria-label="Prototype variants"
      data-ready={ready ? '' : undefined}
      data-position={position === 'top' ? 'top' : undefined}
    >
      <span
        className="proto-picker-highlight"
        aria-hidden="true"
        style={{ width: highlight.width, transform: `translateX(${highlight.offset}px)` }}
      />
      {Arr.map(names, (name, index) => (
        <button
          key={name}
          type="button"
          ref={(element) => {
            items.current[index] = element
          }}
          className="proto-picker-item"
          data-active={index === active ? '' : undefined}
          aria-current={index === active ? 'true' : undefined}
          onClick={() => {
            onSelect(index)
          }}
        >
          {name}
        </button>
      ))}
      {hasReplay ? (
        <>
          <span className="proto-picker-divider" aria-hidden="true" />
          <button
            type="button"
            className="proto-picker-item proto-picker-replay"
            aria-label="Replay animation (R)"
            onClick={onReplay}
          >
            {REPLAY_MARK}
          </button>
        </>
      ) : null}
    </nav>,
    document.body,
  )
}
