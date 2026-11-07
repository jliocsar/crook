import { cn } from 'cn'
import { ArrowUp } from 'lucide-react'
import * as React from 'react'

import { keepFocus } from '@crook/web/components/KeepFocus'
import { isSendKey } from '@crook/web/components/SendKey'
import { FITTED_FIELD, FitsItsText } from '@crook/web/components/ui/fits-its-text'
import { ROUND_BUTTON } from '@crook/web/components/ui/prompt-input'
import { Spinner } from '@crook/web/components/ui/spinner'

const SEND_SPINNER_SIZE = 16
const FIELD_TEXT = 'max-h-[calc(6lh_+_1.25rem)] px-2 py-2.5 text-base leading-6'

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
  const sendable = canSend && task.trim() !== ''

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
        <FitsItsText text={task} textClass={FIELD_TEXT} className="min-w-0 flex-1">
          <textarea
            id={fieldId}
            rows={1}
            value={task}
            disabled={disabled}
            placeholder="What should Claude work on?"
            className={cn(
              FITTED_FIELD,
              FIELD_TEXT,
              'placeholder:text-muted-foreground block bg-transparent outline-none disabled:opacity-60',
            )}
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
        </FitsItsText>
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
