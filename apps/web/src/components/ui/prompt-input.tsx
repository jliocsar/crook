import { Spinner } from '@crook/web/components/ui/spinner'
import { cn } from 'cn'
import { ArrowUp, Square } from 'lucide-react'
import * as React from 'react'

import { keepFocus } from '@crook/web/components/KeepFocus'
import { isSendKey } from '@crook/web/components/SendKey'
import { FITTED_FIELD, FitsItsText } from '@crook/web/components/ui/fits-its-text'

export type PromptInputStatus = 'ready' | 'working'

type PromptInputProps = Omit<React.HTMLAttributes<HTMLFormElement>, 'onSubmit' | 'children'> & {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (value: string) => void
  onStop: () => void
  status: PromptInputStatus
  placeholder: string
  label: string
  disabled?: boolean
  sending?: boolean
  stopping?: boolean
  fieldRef: React.RefObject<HTMLTextAreaElement | null>
  submitLabel?: string
  stopLabel?: string
}

const FIELD_TEXT = 'px-3.5 py-3 text-base leading-6'
const FIELD_ROWS_HEIGHT = 'max-h-42'
const STOP_ICON_SIZE = 13
const SEND_ICON_SIZE = 16

export const ROUND_BUTTON =
  'bg-foreground text-background focus-visible:ring-ring inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-opacity duration-150 focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none'

export function PromptInput({
  value,
  onValueChange,
  onSubmit,
  onStop,
  status,
  placeholder,
  label,
  disabled = false,
  sending = false,
  stopping = false,
  fieldRef,
  submitLabel = 'Send',
  stopLabel = 'Stop',
  className,
  ...formProps
}: PromptInputProps) {
  const fieldId = React.useId()
  const canSend = value.trim().length > 0 && !disabled && !sending

  const submit = () => {
    if (canSend) {
      onSubmit(value.trim())
    }
  }

  return (
    <form
      data-slot="prompt-input"
      data-status={status}
      className={cn(
        'border-border bg-card focus-within:ring-ring/40 rounded-[calc(var(--radius)+0.35rem)] border transition-[box-shadow,border-color] duration-150 focus-within:ring-2 motion-reduce:transition-none',
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      {...formProps}
    >
      <label className="sr-only" htmlFor={fieldId}>
        {label}
      </label>
      <FitsItsText text={value} textClass={cn(FIELD_TEXT, FIELD_ROWS_HEIGHT)}>
        <textarea
          ref={fieldRef}
          id={fieldId}
          data-slot="prompt-input-field"
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          enterKeyHint="enter"
          className={cn(
            FITTED_FIELD,
            FIELD_TEXT,
            'placeholder:text-muted-foreground block bg-transparent outline-none disabled:opacity-60',
          )}
          onChange={(event) => {
            onValueChange(event.target.value)
          }}
          onKeyDown={(event) => {
            if (isSendKey(event)) {
              event.preventDefault()
              submit()
            }
          }}
        />
      </FitsItsText>
      <div data-slot="prompt-input-toolbar" className="flex items-center gap-2 px-2 pb-2">
        {status === 'working' ? (
          <button
            key="stop"
            type="button"
            data-slot="prompt-input-stop"
            aria-label={stopLabel}
            aria-busy={stopping || undefined}
            disabled={disabled || stopping}
            className={cn(ROUND_BUTTON, 'ml-auto disabled:opacity-50')}
            onPointerDown={keepFocus}
            onClick={onStop}
          >
            <Spinner
              pending={stopping}
              size={STOP_ICON_SIZE}
              idle={<Square aria-hidden="true" size={STOP_ICON_SIZE} fill="currentColor" />}
            />
          </button>
        ) : (
          <button
            key="send"
            type="submit"
            data-slot="prompt-input-submit"
            aria-label={submitLabel}
            aria-busy={sending || undefined}
            disabled={!canSend}
            className={cn(ROUND_BUTTON, 'ml-auto disabled:opacity-40')}
            onPointerDown={keepFocus}
          >
            <Spinner
              pending={sending}
              size={SEND_ICON_SIZE}
              idle={<ArrowUp aria-hidden="true" size={SEND_ICON_SIZE} />}
            />
          </button>
        )}
      </div>
    </form>
  )
}
