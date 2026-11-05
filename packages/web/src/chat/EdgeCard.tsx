import { cn } from 'cn'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import { CircleOff, SquareX } from 'lucide-react'
import * as React from 'react'

import type { EdgeKind } from '@crook/web/chat/ChatModel'
import { ActionFailure } from '@crook/web/components/ActionFailure'
import { Button } from '@crook/web/components/ui/button'
import { Spinner } from '@crook/web/components/ui/spinner'
import { shortElapsed } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

export interface Restart {
  readonly start: () => void
  readonly starting: boolean
  readonly disabled: boolean
  readonly failure: Option.Option<string>
}

interface EdgeCardProps {
  readonly kind: EdgeKind
  readonly machineLabel: string
  readonly since: Option.Option<DateTime.Utc>
  readonly restart: Option.Option<Restart>
  readonly onBack: () => void
  readonly backLabel: string
  readonly takeFocus: boolean
  readonly className?: string
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

const detailOf = ({ kind, since }: EdgeCardProps, now: DateTime.Utc): Option.Option<string> =>
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

function BackButton({
  ref,
  backLabel,
  onBack,
  className,
}: {
  ref: React.Ref<HTMLButtonElement> | undefined
  backLabel: string
  onBack: () => void
  className: string
}) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      className={cn('min-h-11 rounded-full', className)}
      aria-label={backLabel}
      onClick={onBack}
    >
      Back
    </Button>
  )
}

export function EdgeCard(props: EdgeCardProps) {
  const { kind, machineLabel, restart, onBack, backLabel, takeFocus, className } = props
  const firstButton = React.useRef<HTMLButtonElement>(null)
  const title = edgeTitle(kind, machineLabel)
  const now = useNow()

  React.useEffect(() => {
    if (takeFocus) {
      firstButton.current?.focus({ preventScroll: true, focusVisible: false })
    }
  }, [takeFocus])

  return (
    <section
      data-slot="edge-card"
      data-kind={kind}
      aria-label={title}
      className={cn(
        'border-border bg-card grid content-center gap-3 rounded-[calc(var(--radius)+0.35rem)] border',
        kind === 'away' ? 'p-3' : 'p-4',
        className,
      )}
    >
      <div className={cn('flex gap-3', kind === 'away' ? 'items-center' : 'items-start')}>
        <span className="text-muted-foreground mt-0.5 shrink-0">
          <EdgeIcon kind={kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            role="status"
            className={cn(
              'text-foreground text-sm leading-5 font-semibold',
              kind === 'away' && 'truncate',
            )}
          >
            {title}
          </p>
          {Option.match(detailOf(props, now), {
            onNone: () => null,
            onSome: (detail) => <p className="text-muted-foreground text-sm leading-5">{detail}</p>,
          })}
        </div>
        {kind === 'away' ? (
          <BackButton
            ref={firstButton}
            backLabel={backLabel}
            onBack={onBack}
            className="shrink-0 px-5"
          />
        ) : null}
      </div>
      {kind === 'away' ? null : (
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
          <BackButton
            ref={Option.isNone(restart) ? firstButton : undefined}
            backLabel={backLabel}
            onBack={onBack}
            className="flex-1"
          />
        </div>
      )}
      <ActionFailure message={Option.flatMap(restart, (found) => found.failure)} />
    </section>
  )
}
