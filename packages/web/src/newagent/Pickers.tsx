import { cn } from 'cn'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import { Check, GitBranch } from 'lucide-react'
import * as React from 'react'

import { isOnline } from '@crook/domain/HerdView'
import type { HerdMachine } from '@crook/domain/HerdView'
import type { MachineId } from '@crook/domain/Ids'
import type { Place } from '@crook/domain/Place'
import { MachineBadge } from '@crook/web/components/MachineBadge'
import { Button } from '@crook/web/components/ui/button'
import { folderName, validBranch } from '@crook/web/newagent/NewAgentLayout'

const FIELD =
  'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/35 placeholder:text-muted-foreground h-11 w-full min-w-0 rounded-lg border px-3 font-mono text-base outline-none focus-visible:ring-3'

const ROW =
  'enabled:hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 w-full touch-manipulation items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] outline-none select-none focus-visible:relative focus-visible:z-10 focus-visible:ring-3 disabled:opacity-50 motion-reduce:transition-none'

function MonoField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      className={FIELD}
      {...props}
    />
  )
}

function Trailing({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground max-w-[40%] shrink-0 truncate font-mono text-xs">
      {children}
    </span>
  )
}

function ChoiceRow({
  title,
  detail,
  mono = false,
  trailing,
  selected,
  disabled = false,
  onClick,
}: {
  title: React.ReactNode
  detail?: React.ReactNode
  mono?: boolean
  trailing?: React.ReactNode
  selected: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(ROW, selected && 'bg-muted')}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base leading-6">{title}</span>
        {detail === undefined ? null : (
          <span
            className={cn(
              'text-muted-foreground block truncate leading-4',
              mono ? 'font-mono text-xs' : 'text-sm',
            )}
          >
            {detail}
          </span>
        )}
      </span>
      {trailing}
      <Check
        aria-hidden="true"
        className={cn('text-primary size-4 shrink-0', !selected && 'invisible')}
      />
    </button>
  )
}

export function MachineChoices({
  machines,
  now,
  selected,
  onPick,
}: {
  machines: readonly HerdMachine[]
  now: DateTime.Utc
  selected: MachineId
  onPick: (machine: HerdMachine) => void
}) {
  return (
    <div className="-mx-3 grid grid-cols-1">
      {machines.map((entry) => (
        <ChoiceRow
          key={entry.machine.id}
          title={entry.machine.label}
          selected={entry.machine.id === selected}
          disabled={!isOnline(entry)}
          trailing={<MachineBadge machine={entry.machine} now={now} plain />}
          onClick={() => {
            onPick(entry)
          }}
        />
      ))}
    </div>
  )
}

export function FolderChoices({
  places,
  selected,
  validPath,
  onPick,
  onType,
}: {
  places: readonly Place[]
  selected: Option.Option<string>
  validPath: (typed: string) => boolean
  onPick: (place: Place) => void
  onType: (typed: string) => void
}) {
  const [typed, setTyped] = React.useState('')
  const valid = validPath(typed)
  const hintId = React.useId()

  return (
    <div className="-mx-3 grid grid-cols-1">
      {places.map((place) => (
        <ChoiceRow
          key={place.folder}
          title={folderName(place.folder)}
          detail={place.folder}
          mono
          selected={Option.contains(selected, place.folder)}
          trailing={Option.match(
            Option.flatMap(place.checkout, (checkout) => checkout.branch),
            {
              onNone: () => null,
              onSome: (branch) => <Trailing>{branch}</Trailing>,
            },
          )}
          onClick={() => {
            onPick(place)
          }}
        />
      ))}
      <form
        className="mx-3 mt-2 grid gap-1"
        onSubmit={(event) => {
          event.preventDefault()

          if (valid) {
            onType(typed)
          }
        }}
      >
        <div className="flex gap-2">
          <MonoField
            value={typed}
            aria-label="Folder path"
            aria-describedby={hintId}
            placeholder="Or type a path"
            onChange={(event) => {
              setTyped(event.target.value)
            }}
          />
          <Button type="submit" variant="secondary" size="touch" disabled={!valid}>
            Use
          </Button>
        </div>
        <p id={hintId} className="text-muted-foreground text-xs leading-4">
          {typed.trim() === '' || valid ? '' : 'Type the full path, starting with /.'}
        </p>
      </form>
    </div>
  )
}

export function BranchChoices({
  checkout,
  worktree,
  onCheckout,
  onWorktree,
  onWorktreeChange,
  onDone,
}: {
  checkout: string
  worktree: Option.Option<string>
  onCheckout: () => void
  onWorktree: () => void
  onWorktreeChange: (branch: string) => void
  onDone: () => void
}) {
  return (
    <div className="-mx-3 grid grid-cols-1">
      <ChoiceRow
        title="Work in the checkout"
        detail={checkout}
        mono
        selected={Option.isNone(worktree)}
        onClick={onCheckout}
      />
      <ChoiceRow
        title="New worktree"
        detail="Own branch and folder"
        selected={Option.isSome(worktree)}
        trailing={
          <GitBranch aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
        }
        onClick={onWorktree}
      />
      {Option.match(worktree, {
        onNone: () => null,
        onSome: (branch) => (
          <form
            className="mx-3 mt-1 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()

              if (Option.isSome(validBranch(branch))) {
                onDone()
              }
            }}
          >
            <MonoField
              value={branch}
              aria-label="Branch name"
              placeholder="Branch name"
              onChange={(event) => {
                onWorktreeChange(event.target.value)
              }}
            />
            <Button
              type="submit"
              variant="secondary"
              size="touch"
              disabled={Option.isNone(validBranch(branch))}
            >
              Done
            </Button>
          </form>
        ),
      })}
    </div>
  )
}
