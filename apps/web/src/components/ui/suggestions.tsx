import { cn } from 'cn'
import * as React from 'react'

export type Suggestion = {
  id: string
  label: React.ReactNode
  hint?: React.ReactNode | undefined
  description?: React.ReactNode | undefined
}

export type SuggestionGroup = {
  id: string
  label: string
  suggestions: readonly Suggestion[]
}

type SuggestionsProps = Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'onSelect'> & {
  groups: readonly SuggestionGroup[]
  onSelect: (suggestion: Suggestion) => void
  label?: string
  disabled?: boolean
}

const describedBy = (idPrefix: string, suggestion: Suggestion): string | undefined => {
  const parts = [
    ...(suggestion.hint === undefined ? [] : [`${idPrefix}-${suggestion.id}-hint`]),
    ...(suggestion.description === undefined ? [] : [`${idPrefix}-${suggestion.id}-description`]),
  ]

  return parts.length === 0 ? undefined : parts.join(' ')
}

export function Suggestions({
  groups,
  onSelect,
  label = 'Suggested prompts',
  disabled = false,
  className,
  ...rootProps
}: SuggestionsProps) {
  const idPrefix = React.useId()

  if (groups.length === 0) {
    return null
  }

  return (
    <nav
      data-slot="suggestions"
      aria-label={label}
      className={cn(
        'border-border bg-background max-h-64 min-w-0 overflow-y-auto overscroll-contain rounded-xl border',
        className,
      )}
      {...rootProps}
    >
      {groups.map((group) => (
        <section key={group.id} aria-label={group.label} data-slot="suggestion-group">
          <h3 className="bg-background text-muted-foreground sticky top-0 px-3 pt-2 pb-1 text-xs font-medium">
            {group.label}
          </h3>
          <ul>
            {group.suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <button
                  type="button"
                  data-slot="suggestion"
                  aria-labelledby={`${idPrefix}-${suggestion.id}-label`}
                  aria-describedby={describedBy(idPrefix, suggestion)}
                  disabled={disabled}
                  className="hover:bg-muted focus-visible:bg-muted flex min-h-11 w-full min-w-0 flex-col justify-center gap-0.5 px-3 py-1.5 text-left transition-colors duration-150 focus-visible:outline-none disabled:opacity-50 motion-reduce:transition-none"
                  onClick={() => {
                    onSelect(suggestion)
                  }}
                >
                  <span className="flex max-w-full min-w-0 items-baseline gap-2">
                    <span
                      id={`${idPrefix}-${suggestion.id}-label`}
                      className="max-w-full shrink-0 truncate font-mono text-sm"
                    >
                      {suggestion.label}
                    </span>
                    {suggestion.hint === undefined ? null : (
                      <span
                        id={`${idPrefix}-${suggestion.id}-hint`}
                        className="text-muted-foreground min-w-0 truncate font-mono text-xs"
                      >
                        {suggestion.hint}
                      </span>
                    )}
                  </span>
                  {suggestion.description === undefined ? null : (
                    <span
                      id={`${idPrefix}-${suggestion.id}-description`}
                      className="text-muted-foreground line-clamp-2 text-xs"
                    >
                      {suggestion.description}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
