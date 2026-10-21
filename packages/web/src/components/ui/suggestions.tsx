import { cn } from 'cn'
import type * as React from 'react'

export type Suggestion = {
  id: string
  label: React.ReactNode
}

export type SuggestionsProps = Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'onSelect'> & {
  suggestions: readonly Suggestion[]
  onSelect: (suggestion: Suggestion) => void
  label?: string
  disabled?: boolean
}

export function Suggestions({
  suggestions,
  onSelect,
  label = 'Suggested prompts',
  disabled = false,
  className,
  ...rootProps
}: SuggestionsProps) {
  if (suggestions.length === 0) {
    return null
  }

  return (
    <nav
      data-slot="suggestions"
      aria-label={label}
      className={cn('min-w-0', className)}
      {...rootProps}
    >
      <ul className="no-scrollbar flex snap-x gap-2 overflow-x-auto pb-1">
        {suggestions.map((suggestion) => (
          <li key={suggestion.id} className="snap-start">
            <button
              type="button"
              data-slot="suggestion"
              disabled={disabled}
              className="border-border hover:bg-muted focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50 motion-reduce:transition-none"
              onClick={() => {
                onSelect(suggestion)
              }}
            >
              {suggestion.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
