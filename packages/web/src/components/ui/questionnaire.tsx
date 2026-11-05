import { cn } from 'cn'
import * as Option from 'effect/Option'
import { Check, TriangleAlert } from 'lucide-react'
import * as React from 'react'

import { Button } from '@crook/web/components/ui/button'
import { Input } from '@crook/web/components/ui/input'
import { Spinner } from '@crook/web/components/ui/spinner'

export interface QuestionChoice {
  readonly id: string
  readonly label: React.ReactNode
  readonly description?: React.ReactNode
}

interface QuestionnaireProps {
  readonly prompt: React.ReactNode
  readonly choices: readonly QuestionChoice[]
  readonly submitLabel: string
  readonly disabled: boolean
  readonly pending: boolean
  readonly onChoose: (id: string) => void
  readonly onFreeform: (text: string) => void
}

const FREEFORM_LABEL = 'Another answer'
const FREEFORM_PLACEHOLDER = 'Something else…'
const REQUIRED_MESSAGE = 'Choose an answer to continue.'

export function Questionnaire({
  prompt,
  choices,
  submitLabel,
  disabled,
  pending,
  onChoose,
  onFreeform,
}: QuestionnaireProps) {
  const reactId = React.useId()
  const [chosen, setChosen] = React.useState(Option.none<string>())
  const [typed, setTyped] = React.useState('')
  const [showError, setShowError] = React.useState(false)
  const errorId = `${reactId}-error`
  const freeformId = `${reactId}-freeform`

  const submit = () => {
    const text = typed.trim()

    if (text !== '') {
      onFreeform(text)

      return
    }

    Option.match(chosen, {
      onNone: () => {
        setShowError(true)
      },
      onSome: (id) => {
        onChoose(id)
      },
    })
  }

  return (
    <form
      data-slot="questionnaire"
      className="border-border bg-card text-card-foreground rounded-[var(--radius)] border"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <fieldset className="border-0 p-0" disabled={disabled}>
        <legend
          data-slot="questionnaire-prompt"
          className="px-4 pt-4 text-sm font-semibold text-pretty"
        >
          {prompt}
        </legend>
        <div className="px-4 pt-2 pb-4">
          <div className="grid gap-1.5">
            {choices.map((choice) => {
              const id = `${reactId}-${choice.id}`
              const isChosen = Option.contains(chosen, choice.id)

              return (
                <label
                  key={choice.id}
                  data-slot="questionnaire-choice"
                  data-chosen={isChosen || undefined}
                  htmlFor={id}
                  className={cn(
                    'border-border flex min-h-11 cursor-pointer items-start gap-2.5 rounded-[calc(var(--radius)-0.25rem)] border px-3 py-2.5 text-sm transition-colors duration-150 motion-reduce:transition-none',
                    isChosen ? 'border-foreground bg-muted/60' : 'hover:bg-muted/40',
                  )}
                >
                  <input
                    id={id}
                    className="mt-0.5"
                    name={reactId}
                    type="radio"
                    checked={isChosen}
                    aria-describedby={showError ? errorId : undefined}
                    onChange={() => {
                      setChosen(Option.some(choice.id))
                      setTyped('')
                      setShowError(false)
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{choice.label}</span>
                    {choice.description === undefined ? null : (
                      <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                        {choice.description}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
          <div className="mt-1.5">
            <label className="sr-only" htmlFor={freeformId}>
              {FREEFORM_LABEL}
            </label>
            <Input
              id={freeformId}
              placeholder={FREEFORM_PLACEHOLDER}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value)
                setShowError(false)

                if (event.target.value.trim() !== '') {
                  setChosen(Option.none())
                }
              }}
            />
          </div>
          {showError ? (
            <p
              id={errorId}
              role="alert"
              className="text-destructive mt-2 flex items-center gap-1.5 text-xs"
            >
              <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
              {REQUIRED_MESSAGE}
            </p>
          ) : null}
        </div>
      </fieldset>
      <div
        data-slot="questionnaire-actions"
        className="border-border flex items-center gap-2 border-t px-3 py-2.5"
      >
        <Button
          type="submit"
          size="touch"
          data-slot="questionnaire-submit"
          disabled={disabled}
          className="ml-auto"
        >
          {submitLabel}
          <Spinner pending={pending} idle={<Check aria-hidden="true" />} />
        </Button>
      </div>
    </form>
  )
}
