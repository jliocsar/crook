import { cn } from 'cn'
import { ArrowUp, Square } from 'lucide-react'
import * as React from 'react'

export type PromptInputStatus = 'ready' | 'working'

export type PromptInputProps = Omit<
  React.HTMLAttributes<HTMLFormElement>,
  'onSubmit' | 'children'
> & {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (value: string) => void
  onStop: () => void
  status: PromptInputStatus
  enterSends: boolean
  placeholder: string
  label: string
  disabled?: boolean
  sending?: boolean
  maxRows?: number
  actions?: React.ReactNode
  fieldRef?: React.RefObject<HTMLTextAreaElement | null>
  submitLabel?: string
  stopLabel?: string
}

const DEFAULT_MAX_ROWS = 6
const STOP_ICON_SIZE = 13
const SEND_ICON_SIZE = 16

const ROUND_BUTTON =
  'bg-foreground text-background focus-visible:ring-ring ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-opacity duration-150 focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none'

const keepFocus = (event: React.PointerEvent) => {
  event.preventDefault()
}

const fitToContent = (field: HTMLTextAreaElement, maxRows: number) => {
  const styles = window.getComputedStyle(field)
  const lineHeight = Number.parseFloat(styles.lineHeight)
  const padding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom)
  const max = lineHeight * maxRows + padding

  field.style.height = 'auto'

  if (Number.isNaN(max)) {
    return
  }

  field.style.height = `${Math.min(field.scrollHeight, max)}px`
  field.style.overflowY = field.scrollHeight > max ? 'auto' : 'hidden'
}

export function PromptInput({
  value,
  onValueChange,
  onSubmit,
  onStop,
  status,
  enterSends,
  placeholder,
  label,
  disabled = false,
  sending = false,
  maxRows = DEFAULT_MAX_ROWS,
  actions,
  fieldRef,
  submitLabel = 'Send',
  stopLabel = 'Stop',
  className,
  ...formProps
}: PromptInputProps) {
  const fieldId = React.useId()
  const ownField = React.useRef<HTMLTextAreaElement>(null)
  const field = fieldRef ?? ownField
  const canSend = value.trim().length > 0 && !disabled && !sending

  React.useLayoutEffect(() => {
    if (field.current !== null) {
      fitToContent(field.current, maxRows)
    }
  }, [field, value, maxRows])

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
      <textarea
        ref={field}
        id={fieldId}
        data-slot="prompt-input-field"
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        enterKeyHint={enterSends ? 'send' : 'enter'}
        className="placeholder:text-muted-foreground block w-full resize-none bg-transparent px-3.5 py-3 text-base leading-6 outline-none disabled:opacity-60"
        onChange={(event) => {
          onValueChange(event.target.value)
        }}
        onKeyDown={(event) => {
          if (
            !enterSends ||
            event.key !== 'Enter' ||
            event.shiftKey ||
            event.nativeEvent.isComposing
          ) {
            return
          }

          event.preventDefault()
          submit()
        }}
      />
      <div data-slot="prompt-input-toolbar" className="flex items-center gap-2 px-2 pb-2">
        {actions}
        {status === 'working' ? (
          <button
            key="stop"
            type="button"
            data-slot="prompt-input-stop"
            aria-label={stopLabel}
            disabled={disabled}
            className={cn(ROUND_BUTTON, 'disabled:opacity-50')}
            onPointerDown={keepFocus}
            onClick={onStop}
          >
            <Square aria-hidden="true" size={STOP_ICON_SIZE} fill="currentColor" />
          </button>
        ) : (
          <button
            key="send"
            type="submit"
            data-slot="prompt-input-submit"
            aria-label={submitLabel}
            aria-busy={sending || undefined}
            disabled={!canSend}
            className={cn(ROUND_BUTTON, 'disabled:opacity-40')}
            onPointerDown={keepFocus}
          >
            <ArrowUp aria-hidden="true" size={SEND_ICON_SIZE} />
          </button>
        )}
      </div>
    </form>
  )
}
