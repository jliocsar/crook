import { cn } from 'cn'
import * as Option from 'effect/Option'
import { Check, TriangleAlert } from 'lucide-react'
import * as React from 'react'

import { Spinner } from '@crook/web/components/ui/spinner'

export type QuestionChoice = {
  id: string
  label: React.ReactNode
  description?: React.ReactNode
}

export type QuestionnaireProps = Omit<
  React.FormHTMLAttributes<HTMLFormElement>,
  'onSubmit' | 'children'
> & {
  prompt: React.ReactNode
  description?: React.ReactNode
  choices: readonly QuestionChoice[]
  freeform?: boolean
  freeformLabel?: string
  freeformPlaceholder?: string
  submitLabel?: string
  requiredMessage?: string
  disabled?: boolean
  pending?: boolean
  onChoose: (id: string) => void
  onFreeform: (text: string) => void
}

const ICON_SIZE = 13

export function Questionnaire({
  prompt,
  description,
  choices,
  freeform = true,
  freeformLabel = 'Another answer',
  freeformPlaceholder = 'Something else…',
  submitLabel = 'Submit',
  requiredMessage = 'Choose an answer to continue.',
  disabled = false,
  pending = false,
  onChoose,
  onFreeform,
  className,
  ...formProps
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
      className={cn(
        'border-border bg-card text-card-foreground rounded-[var(--radius)] border',
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      {...formProps}
    >
      <fieldset className="border-0 p-0" disabled={disabled}>
        <legend
          data-slot="questionnaire-prompt"
          className="px-4 pt-4 text-sm font-semibold text-pretty"
        >
          {prompt}
        </legend>
        <div className="px-4 pt-2 pb-4">
          {description === undefined ? null : (
            <p className="text-muted-foreground mb-3 text-sm leading-relaxed">{description}</p>
          )}
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
          {freeform ? (
            <div className="mt-1.5">
              <label className="sr-only" htmlFor={freeformId}>
                {freeformLabel}
              </label>
              <input
                id={freeformId}
                className="border-border placeholder:text-muted-foreground focus-visible:ring-ring min-h-11 w-full rounded-[calc(var(--radius)-0.25rem)] border bg-transparent px-3 text-base focus-visible:ring-2 focus-visible:outline-none"
                placeholder={freeformPlaceholder}
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
          ) : null}
          {showError ? (
            <p
              id={errorId}
              role="alert"
              className="text-destructive mt-2 flex items-center gap-1.5 text-xs"
            >
              <TriangleAlert aria-hidden="true" size={ICON_SIZE} />
              {requiredMessage}
            </p>
          ) : null}
        </div>
      </fieldset>
      <div
        data-slot="questionnaire-actions"
        className="border-border flex items-center gap-2 border-t px-3 py-2.5"
      >
        <button
          type="submit"
          data-slot="questionnaire-submit"
          disabled={disabled}
          className="bg-foreground text-background focus-visible:ring-ring ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-opacity duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50 motion-reduce:transition-none"
        >
          {submitLabel}
          {pending ? <Spinner size={ICON_SIZE} /> : <Check aria-hidden="true" size={ICON_SIZE} />}
        </button>
      </div>
    </form>
  )
}
