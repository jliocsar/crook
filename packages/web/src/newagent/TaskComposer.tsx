import { ArrowUp } from 'lucide-react'
import * as React from 'react'

import { Spinner } from '@crook/web/components/ui/spinner'

const COARSE_POINTER_QUERY = '(pointer: coarse)'
const SEND_SPINNER_SIZE = 16

const softKeyboard = () => window.matchMedia(COARSE_POINTER_QUERY).matches

const growToContent = (field: HTMLTextAreaElement) => {
  field.style.height = 'auto'
  field.style.height = `${field.scrollHeight}px`
}

export function TaskComposer({
  task,
  disabled,
  canSend,
  sending,
  onTaskChange,
  onSend,
}: {
  task: string
  disabled: boolean
  canSend: boolean
  sending: boolean
  onTaskChange: (task: string) => void
  onSend: () => void
}) {
  const fieldId = React.useId()
  const field = React.useRef<HTMLTextAreaElement>(null)
  const sendable = canSend && task.trim() !== ''

  React.useLayoutEffect(() => {
    if (field.current !== null) {
      growToContent(field.current)
    }
  }, [task])

  return (
    <form
      data-slot="task-composer"
      className="border-border bg-background focus-within:ring-ring/40 rounded-[calc(var(--radius)+0.35rem)] border transition-[box-shadow,border-color] duration-150 focus-within:ring-2 motion-reduce:transition-none"
      onSubmit={(event) => {
        event.preventDefault()

        if (sendable) {
          onSend()
        }
      }}
    >
      <label className="sr-only" htmlFor={fieldId}>
        First message to Claude
      </label>
      <div className="flex items-end gap-2 pr-2 pb-2">
        <textarea
          ref={field}
          id={fieldId}
          rows={1}
          value={task}
          disabled={disabled}
          placeholder="What should Claude work on?"
          className="placeholder:text-muted-foreground block max-h-40 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-3.5 pt-3 pb-1 text-base leading-6 outline-none disabled:opacity-60"
          onChange={(event) => {
            onTaskChange(event.target.value)
          }}
          onKeyDown={(event) => {
            if (
              event.key !== 'Enter' ||
              event.shiftKey ||
              event.nativeEvent.isComposing ||
              softKeyboard()
            ) {
              return
            }

            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }}
        />
        <button
          type="submit"
          aria-label="Start Claude"
          disabled={!sendable}
          className="bg-foreground text-background focus-visible:ring-ring inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-opacity duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40 motion-reduce:transition-none"
          onPointerDown={(event) => {
            event.preventDefault()
          }}
        >
          {sending ? (
            <Spinner size={SEND_SPINNER_SIZE} />
          ) : (
            <ArrowUp aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
    </form>
  )
}
