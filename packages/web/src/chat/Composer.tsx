import * as Option from 'effect/Option'
import { AnimatePresence, motion } from 'motion/react'
import * as React from 'react'

import type { SkillListing } from '@crook/domain/Skill'
import { slashSuggestions } from '@crook/web/chat/SlashCommands'
import { ActionFailure } from '@crook/web/components/ActionFailure'
import { keepFocus } from '@crook/web/components/KeepFocus'
import { PromptInput } from '@crook/web/components/ui/prompt-input'
import { type SuggestionGroup, Suggestions } from '@crook/web/components/ui/suggestions'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { translate, useTransformString } from '@crook/web/motion/TransformString'

export type ComposerMode = 'prompt' | 'decline'

export interface ComposerHandle {
  readonly focus: () => void
}

export interface ComposerProps {
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly onSend: (text: string) => void
  readonly onStop: () => void
  readonly mode: ComposerMode
  readonly working: boolean
  readonly disabled: boolean
  readonly sending: boolean
  readonly stopping: boolean
  readonly placeholder: string
  readonly label: string
  readonly failure: Option.Option<string>
  readonly note: Option.Option<string>
  readonly skills: readonly SkillListing[]
  readonly handle?: React.Ref<ComposerHandle>
}

const SUGGESTION_RISE = 6

const suggestionGroups = (text: string, skills: readonly SkillListing[]): SuggestionGroup[] =>
  slashSuggestions(text, skills).map((group) => ({
    id: group.scope,
    label: group.label,
    suggestions: group.commands.map((command) => ({
      id: command.name,
      label: `/${command.name}`,
      hint: Option.getOrUndefined(command.argumentHint),
      description: command.description === '' ? undefined : command.description,
    })),
  }))

export function Composer({
  value,
  onValueChange,
  onSend,
  onStop,
  mode,
  working,
  disabled,
  sending,
  stopping,
  placeholder,
  label,
  failure,
  note,
  skills,
  handle,
}: ComposerProps) {
  const field = React.useRef<HTMLTextAreaElement>(null)
  const transform = useTransformString()
  const groups = suggestionGroups(value, skills)

  const focusField = () => {
    field.current?.focus()
  }

  React.useImperativeHandle(handle, () => ({ focus: focusField }))

  return (
    <div data-slot="composer" data-mode={mode} className="grid grid-cols-1 gap-2">
      <AnimatePresence initial={false}>
        {groups.length > 0 ? (
          <motion.div
            key="slash"
            initial={{ opacity: 0, transform: transform.translate('Y', SUGGESTION_RISE) }}
            animate={{ opacity: 1, transform: translate('Y', 0) }}
            exit={{ opacity: 0, transform: transform.translate('Y', SUGGESTION_RISE) }}
            transition={motionTokens().fade}
          >
            <Suggestions
              label="Slash commands"
              disabled={disabled}
              onPointerDown={keepFocus}
              groups={groups}
              onSelect={(suggestion) => {
                onValueChange(`/${suggestion.id} `)
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
        placeholder={placeholder}
        label={label}
        disabled={disabled}
        sending={sending}
        stopping={stopping}
        submitLabel={mode === 'decline' ? 'Decline and send' : 'Send'}
        stopLabel="Stop (Esc)"
        className="bg-background"
      />
      <ActionFailure className="px-1" message={failure} />
      {Option.match(note, {
        onNone: () => null,
        onSome: (text) => (
          <p data-slot="composer-note" role="status" className="text-muted-foreground px-1 text-xs">
            {text}
          </p>
        ),
      })}
    </div>
  )
}
