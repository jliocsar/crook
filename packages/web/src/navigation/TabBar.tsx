import { useAtomValue } from '@effect/atom-react/Hooks'
import { Link } from '@tanstack/react-router'
import { Bot, Server, Settings } from 'lucide-react'

import { needsYouAtom } from '@crook/web/atoms/Herd'
import { COLUMN_STYLE } from '@crook/web/navigation/Column'
import { SECTIONS_LABEL } from '@crook/web/navigation/Focus'
import { useAnyScreenPushed } from '@crook/web/navigation/Pushed'
import { needsYouLabel } from '@crook/domain/NeedsYouLabel'

const ACTIVE_STROKE = 2.25
const IDLE_STROKE = 1.75

const TABS = [
  { to: '/', label: 'Agents', Icon: Bot, exact: true },
  { to: '/machines', label: 'Machines', Icon: Server, exact: false },
  { to: '/settings', label: 'Settings', Icon: Settings, exact: false },
] as const

function NeedsYouBadge({ count }: { count: number }) {
  if (count === 0) {
    return null
  }

  return (
    <span
      aria-hidden="true"
      className="bg-primary text-primary-foreground absolute -top-1 left-3.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 font-mono text-[0.625rem] leading-none tabular-nums"
    >
      {count}
    </span>
  )
}

export function TabBar() {
  const covered = useAnyScreenPushed()
  const needsYou = useAtomValue(needsYouAtom)

  return (
    <nav
      aria-label={SECTIONS_LABEL}
      inert={covered}
      className="border-border bg-background/90 fixed bottom-0 z-20 border-t pb-[var(--safe-bottom)] backdrop-blur"
      style={COLUMN_STYLE}
    >
      <div className="grid grid-cols-3">
        {TABS.map(({ to, label, Icon, exact }) => (
          <Link
            key={to}
            to={to}
            replace
            activeOptions={{ exact }}
            className="text-muted-foreground data-[status=active]:text-primary flex min-h-[var(--tab-bar-height)] touch-manipulation flex-col items-center justify-center gap-1 text-xs leading-4 font-medium select-none"
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <Icon
                    aria-hidden="true"
                    className="size-5"
                    strokeWidth={isActive ? ACTIVE_STROKE : IDLE_STROKE}
                  />
                  {to === '/' ? <NeedsYouBadge count={needsYou} /> : null}
                </span>
                {label}
                {to === '/' && needsYou > 0 ? (
                  <span className="sr-only">, {needsYouLabel(needsYou)}</span>
                ) : null}
              </>
            )}
          </Link>
        ))}
      </div>
    </nav>
  )
}
