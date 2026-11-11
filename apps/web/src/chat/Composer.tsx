import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { Paperclip } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import * as React from 'react'

import type { SkillListing } from '@crook/domain/Skill'
import { AttachmentStrip } from '@crook/web/chat/AttachmentStrip'
import { Collapse } from '@crook/web/components/Collapse'
import {
  attachmentOf,
  type DraftAttachment,
  filesOfTransfer,
  withAdded,
} from '@crook/web/chat/Attachments'
import { browserImageCodec } from '@crook/web/chat/BrowserImageCodec'
import { slashSuggestions } from '@crook/web/chat/SlashCommands'
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
  readonly skills: readonly SkillListing[]
  readonly handle?: React.Ref<ComposerHandle>
  readonly attachments: readonly DraftAttachment[]
  readonly onAttachmentsChange: (attachments: readonly DraftAttachment[]) => void
  readonly attachRefusal: Option.Option<string>
  readonly onAttachNote: (note: string) => void
}

const SUGGESTION_RISE = 6
const ATTACH_ICON_SIZE = 18

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
  skills,
  handle,
  attachments,
  onAttachmentsChange,
  attachRefusal,
  onAttachNote,
}: ComposerProps) {
  const field = React.useRef<HTMLTextAreaElement>(null)
  const picker = React.useRef<HTMLInputElement>(null)
  const latest = React.useRef(attachments)
  const prompting = mode === 'prompt'

  latest.current = attachments

  const attach = (files: readonly File[]) => {
    if (files.length === 0) {
      return
    }

    Effect.runFork(
      Effect.forEach(files, (file) => attachmentOf(browserImageCodec, file)).pipe(
        Effect.flatMap((added) => withAdded(latest.current, added)),
        Effect.match({
          onFailure: (refusal) => {
            onAttachNote(refusal.message)
          },
          onSuccess: (next) => {
            latest.current = next
            onAttachmentsChange(next)
          },
        }),
      ),
    )
  }

  const openPicker = () => {
    Option.match(attachRefusal, {
      onNone: () => {
        picker.current?.click()
      },
      onSome: onAttachNote,
    })
  }

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
        status={
          working && prompting && value.trim() === '' && attachments.length === 0
            ? 'working'
            : 'ready'
        }
        sendsWithoutText={prompting && attachments.length > 0}
        above={
          <Collapse open={attachments.length > 0}>
            <AttachmentStrip
              attachments={attachments}
              disabled={disabled}
              onRemove={(removed) => {
                onAttachmentsChange(attachments.filter((attachment) => attachment !== removed))
              }}
            />
          </Collapse>
        }
        leading={
          prompting ? (
            <>
              <button
                type="button"
                data-slot="composer-attach"
                aria-label="Attach a photo or file"
                aria-disabled={Option.isSome(attachRefusal) || undefined}
                disabled={disabled}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40 aria-disabled:opacity-40"
                onPointerDown={keepFocus}
                onClick={openPicker}
              >
                <Paperclip aria-hidden="true" size={ATTACH_ICON_SIZE} />
              </button>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                tabIndex={-1}
                onChange={(event) => {
                  attach(Array.from(event.target.files ?? []))
                  event.target.value = ''
                }}
              />
            </>
          ) : null
        }
        onPaste={(event) => {
          const files = filesOfTransfer(event.clipboardData)

          if (files.length > 0 && prompting) {
            event.preventDefault()
            Option.match(attachRefusal, {
              onNone: () => {
                attach(files)
              },
              onSome: onAttachNote,
            })
          }
        }}
        placeholder={placeholder}
        label={label}
        disabled={disabled}
        sending={sending}
        stopping={stopping}
        submitLabel={mode === 'decline' ? 'Decline and send' : 'Send'}
        stopLabel="Stop (Esc)"
        className="bg-background"
      />
    </div>
  )
}
