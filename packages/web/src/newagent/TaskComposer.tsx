import { cn } from 'cn'
import { ArrowUp } from 'lucide-react'
import * as React from 'react'

import { keepFocus } from '@crook/web/components/KeepFocus'
import { isSendKey } from '@crook/web/components/SendKey'
import { ROUND_BUTTON } from '@crook/web/components/ui/prompt-input'
import { Spinner } from '@crook/web/components/ui/spinner'

const SEND_SPINNER_SIZE = 16

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
      <div className="flex items-end gap-2 p-1.5">
        <textarea
          ref={field}
          id={fieldId}
          rows={1}
          value={task}
          disabled={disabled}
          placeholder="What should Claude work on?"
          className="placeholder:text-muted-foreground block max-h-[calc(6lh_+_1.25rem)] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2.5 text-base leading-6 outline-none disabled:opacity-60"
          onChange={(event) => {
            onTaskChange(event.target.value)
          }}
          onKeyDown={(event) => {
            if (isSendKey(event)) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <button
          type="submit"
          aria-label="Start Claude"
          disabled={!sendable}
          className={cn(ROUND_BUTTON, 'disabled:opacity-40')}
          onPointerDown={keepFocus}
        >
          <Spinner
            pending={sending}
            size={SEND_SPINNER_SIZE}
            idle={<ArrowUp aria-hidden="true" className="size-4" />}
          />
        </button>
      </div>
    </form>
  )
}
