import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import { CircleOff, SquareX } from 'lucide-react'
import * as React from 'react'

import type { EdgeKind } from '@crook/web/chat/ChatModel'
import { ActionFailure } from '@crook/web/components/ActionFailure'
import { Button } from '@crook/web/components/ui/button'
import { Spinner } from '@crook/web/components/ui/spinner'
import { shortElapsed } from '@crook/web/time/Elapsed'

export interface Restart {
  readonly start: () => void
  readonly starting: boolean
  readonly disabled: boolean
  readonly failure: Option.Option<string>
}

export interface EdgeCardProps {
  readonly kind: EdgeKind
  readonly machineLabel: string
  readonly since: Option.Option<DateTime.Utc>
  readonly now: DateTime.Utc
  readonly restart: Option.Option<Restart>
  readonly onBack: () => void
  readonly backLabel: string
  readonly takeFocus: boolean
}

const EDGE_ICON_SIZE = 20

const ENDED_TITLE = { closed: 'This pane closed', exited: 'Claude exited' } satisfies Record<
  Exclude<EdgeKind, 'away'>,
  string
>

const edgeTitle = (kind: EdgeKind, machineLabel: string): string =>
  kind === 'away' ? `${machineLabel} is offline` : ENDED_TITLE[kind]

const agoLine = (since: Option.Option<DateTime.Utc>, now: DateTime.Utc): Option.Option<string> =>
  Option.map(since, (at) => `${shortElapsed(now, at)} ago`)

const detailOf = ({ kind, since, now }: EdgeCardProps): Option.Option<string> =>
  kind === 'away'
    ? Option.some(
        Option.match(agoLine(since, now), {
          onNone: () => 'Waiting for it.',
          onSome: (ago) => `Waiting for it. Last heard from ${ago}.`,
        }),
      )
    : agoLine(since, now)

function EdgeIcon({ kind }: { kind: EdgeKind }) {
  if (kind === 'away') {
    return <Spinner size={EDGE_ICON_SIZE} className="text-muted-foreground" />
  }

  return kind === 'closed' ? (
    <SquareX aria-hidden="true" size={EDGE_ICON_SIZE} />
  ) : (
    <CircleOff aria-hidden="true" size={EDGE_ICON_SIZE} />
  )
}

export function EdgeCard(props: EdgeCardProps) {
  const { kind, machineLabel, restart, onBack, backLabel, takeFocus } = props
  const firstButton = React.useRef<HTMLButtonElement>(null)
  const title = edgeTitle(kind, machineLabel)

  React.useEffect(() => {
    if (takeFocus) {
      firstButton.current?.focus({ preventScroll: true })
    }
  }, [takeFocus])

  return (
    <section
      data-slot="edge-card"
      data-kind={kind}
      aria-label={title}
      className="border-border bg-card grid gap-3 rounded-[calc(var(--radius)+0.35rem)] border p-4"
    >
      <div className="flex items-start gap-3">
        <span className="text-muted-foreground mt-0.5 shrink-0">
          <EdgeIcon kind={kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p role="status" className="text-foreground text-sm leading-5 font-semibold">
            {title}
          </p>
          {Option.match(detailOf(props), {
            onNone: () => null,
            onSome: (detail) => <p className="text-muted-foreground text-sm leading-5">{detail}</p>,
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {Option.match(restart, {
          onNone: () => null,
          onSome: ({ start, starting, disabled }) => (
            <Button
              ref={firstButton}
              type="button"
              className="min-h-11 flex-1 rounded-full"
              disabled={disabled || starting}
              aria-busy={starting || undefined}
              onClick={start}
            >
              Start Claude here again
            </Button>
          ),
        })}
        <Button
          ref={Option.isNone(restart) ? firstButton : undefined}
          type="button"
          variant="outline"
          className="min-h-11 flex-1 rounded-full"
          aria-label={backLabel}
          onClick={onBack}
        >
          Back
        </Button>
      </div>
      <ActionFailure message={Option.flatMap(restart, (found) => found.failure)} />
    </section>
  )
}
