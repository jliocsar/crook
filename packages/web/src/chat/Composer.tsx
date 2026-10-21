import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import { Slash } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import * as React from 'react'

import { Button } from '@crook/web/components/ui/button'
import { PromptInput } from '@crook/web/components/ui/prompt-input'
import { Suggestions } from '@crook/web/components/ui/suggestions'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { translate, useTransformString } from '@crook/web/motion/TransformString'

export type ComposerMode = 'prompt' | 'decline'

export interface ComposerProps {
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly onSend: (text: string) => void
  readonly onStop: () => void
  readonly mode: ComposerMode
  readonly working: boolean
  readonly disabled: boolean
  readonly sending: boolean
  readonly placeholder: string
  readonly label: string
  readonly failure: Option.Option<string>
}

const COARSE_POINTER = '(pointer: coarse)'
const SLASH_ONLY = /^\/\S*$/u
const SUGGESTION_RISE = 6

export const SLASH_COMMANDS = ['/compact', '/clear', '/model']

export const slashSuggestions = (text: string): readonly string[] =>
  SLASH_ONLY.test(text) ? Arr.filter(SLASH_COMMANDS, (command) => command.startsWith(text)) : []

const subscribeToPointer = (notify: () => void) => {
  const query = window.matchMedia(COARSE_POINTER)

  query.addEventListener('change', notify)

  return () => {
    query.removeEventListener('change', notify)
  }
}

export const useCoarsePointer = (): boolean =>
  React.useSyncExternalStore(
    subscribeToPointer,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false,
  )

const keepFocus = (event: React.PointerEvent) => {
  event.preventDefault()
}

export function Composer({
  value,
  onValueChange,
  onSend,
  onStop,
  mode,
  working,
  disabled,
  sending,
  placeholder,
  label,
  failure,
}: ComposerProps) {
  const field = React.useRef<HTMLTextAreaElement>(null)
  const coarse = useCoarsePointer()
  const transform = useTransformString()
  const matches = slashSuggestions(value)

  const focusField = () => {
    field.current?.focus()
  }

  return (
    <div data-slot="composer" data-mode={mode} className="grid gap-2">
      <AnimatePresence initial={false}>
        {matches.length > 0 ? (
          <motion.div
            key="slash"
            initial={{ opacity: 0, transform: transform.translate('Y', SUGGESTION_RISE) }}
            animate={{ opacity: 1, transform: translate('Y', 0) }}
            exit={{ opacity: 0, transform: transform.translate('Y', SUGGESTION_RISE) }}
            transition={motionTokens().fade}
          >
            <Suggestions
              label="Slash commands"
              className="[&_button]:font-mono"
              disabled={disabled}
              onPointerDown={keepFocus}
              suggestions={matches.map((command) => ({ id: command, label: command }))}
              onSelect={(suggestion) => {
                onValueChange(`${suggestion.id} `)
                focusField()
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <PromptInput
        fieldRef={field}
        value={value}
        onValueChange={onValueChange}
        onSubmit={onSend}
        onStop={onStop}
        status={working && mode === 'prompt' && value.trim() === '' ? 'working' : 'ready'}
        enterSends={!coarse}
        placeholder={placeholder}
        label={label}
        disabled={disabled}
        sending={sending}
        submitLabel={mode === 'decline' ? 'Decline and send' : 'Send'}
        stopLabel="Stop (Esc)"
        className="bg-background"
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-touch"
            className="text-muted-foreground rounded-full"
            aria-label="Slash command"
            disabled={disabled || mode === 'decline'}
            onPointerDown={keepFocus}
            onClick={() => {
              onValueChange('/')
              focusField()
            }}
          >
            <Slash />
          </Button>
        }
      />
      {Option.match(failure, {
        onNone: () => null,
        onSome: (message) => (
          <p role="alert" className="text-destructive px-1 text-sm leading-5">
            {message}
          </p>
        ),
      })}
    </div>
  )
}
