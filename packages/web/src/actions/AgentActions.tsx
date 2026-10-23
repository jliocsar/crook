import { useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import { RegistryContext } from '@effect/atom-react/RegistryContext'
import { useRouter } from '@tanstack/react-router'
import { cn } from 'cn'
import * as Effect from 'effect/Effect'
import * as Equal from 'effect/Equal'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import { Pencil, Pin, PinOff } from 'lucide-react'
import * as React from 'react'

import { type AgentRow, agentTitle, agentTitleOrPane } from '@crook/domain/AgentRow'
import { toGlobalPaneId } from '@crook/domain/Ids'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import {
  closeNeedsConfirmation,
  failureOf,
  isInFlightOrDone,
  keepsName,
  labelFromInput,
  PANE_CLOSED_NOTICE,
  SheetOutcome,
} from '@crook/web/actions/PaneActions'
import {
  ActionsIntent,
  agentActionsAtom,
  agentActionsViewAtom,
  agentActionsViewsAtom,
  PaneAddress,
} from '@crook/web/atoms/AgentActions'
import type { ActionsOrigin, AgentActionsView } from '@crook/web/atoms/AgentActions'
import type { CommandProgress } from '@crook/web/atoms/ActionProgress'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { ToastIntent, toastAtom } from '@crook/web/atoms/Toast'
import { ActionFailure } from '@crook/web/components/ActionFailure'
import { Sheet } from '@crook/web/components/Sheet'
import { Button } from '@crook/web/components/ui/button'
import { HoldButton } from '@crook/web/components/ui/hold-button'
import { Input } from '@crook/web/components/ui/input'
import type { AgentCardModel } from '@crook/web/herd/HerdLayout'
import { restoreFocus } from '@crook/web/navigation/Focus'
import { leaveForHerd } from '@crook/web/navigation/LeaveForHerd'

export type OpenAgentActions = (machine: MachineId, pane: PaneId, origin: ActionsOrigin) => void

interface ShownAgent {
  readonly view: AgentActionsView
  readonly card: AgentCardModel
}

const SHEET_ACTION = 'w-full justify-start text-base'
const CLOSING_LABEL = 'Closing…'

const holdLabel = ({ closing, confirming }: { closing: boolean; confirming: boolean }) => {
  if (closing) {
    return CLOSING_LABEL
  }

  return confirming ? 'Hold to close anyway' : 'Hold to close agent'
}

export const useOpenAgentActions = (): OpenAgentActions => {
  const dispatch = useAtomSet(agentActionsAtom)

  return (machine, pane, origin) => {
    dispatch(ActionsIntent.Open({ agent: new PaneAddress({ machine, pane }), origin }))
  }
}

export const useClosedFromChat = (machine: MachineId, pane: PaneId): boolean => {
  const views = useAtomValue(agentActionsViewsAtom)
  const agent = new PaneAddress({ machine, pane })
  const closingNow = views.some(
    (view) =>
      view.session.origin === 'chat' &&
      Equal.equals(view.session.agent, agent) &&
      SheetOutcome.$is('Closed')(view.outcome),
  )
  const [closed, setClosed] = React.useState(closingNow)

  if (closingNow && !closed) {
    setClosed(true)
  }

  return closed || closingNow
}

const shownAfter = (
  view: Option.Option<AgentActionsView>,
  previous: Option.Option<ShownAgent>,
): Option.Option<ShownAgent> =>
  Option.match(view, {
    onNone: () => previous,
    onSome: (current) =>
      pipe(
        current.card,
        Option.orElse(() =>
          pipe(
            previous,
            Option.filter((shown) => Equal.equals(shown.view.session.agent, current.session.agent)),
            Option.map((shown) => shown.card),
          ),
        ),
        Option.map((card): ShownAgent => ({ view: current, card })),
      ),
  })

const useShownAgent = (view: Option.Option<AgentActionsView>): Option.Option<ShownAgent> => {
  const [seen, setSeen] = React.useState(view)
  const [shown, setShown] = React.useState(() => shownAfter(view, Option.none()))

  if (view === seen) {
    return shown
  }

  const next = shownAfter(view, shown)

  setSeen(view)
  setShown(next)

  return next
}

function RenameField({
  row,
  progress,
  disabled,
  onRename,
}: {
  row: AgentRow
  progress: CommandProgress
  disabled: boolean
  onRename: (label: Option.Option<string>) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(() => agentTitle(row))
  const [invalid, setInvalid] = React.useState(Option.none<string>())
  const field = React.useRef<HTMLInputElement>(null)
  const saving = isInFlightOrDone(progress)

  React.useEffect(() => {
    if (editing) {
      field.current?.focus({ preventScroll: true })
    }
  }, [editing])

  if (!editing) {
    return (
      <Button
        variant="secondary"
        size="touch"
        className={SHEET_ACTION}
        disabled={disabled}
        onClick={() => {
          setEditing(true)
        }}
      >
        <Pencil aria-hidden="true" /> Rename
      </Button>
    )
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        Result.match(labelFromInput(draft), {
          onFailure: (error) => {
            setInvalid(Option.some(error.message))
          },
          onSuccess: (label) => {
            setInvalid(Option.none())

            if (keepsName(row, label)) {
              setEditing(false)

              return
            }

            onRename(label)
          },
        })
      }}
    >
      <div className="flex gap-2">
        <Input
          ref={field}
          value={draft}
          aria-label="Agent name"
          placeholder={row.title}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
        />
        <Button type="submit" size="touch" disabled={disabled || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <ActionFailure message={Option.orElse(invalid, () => failureOf(progress))} />
    </form>
  )
}

function AgentActionsSheet({
  open,
  shown,
  canAct,
  canPin,
  onRename,
  onPin,
  onClose,
  onDismiss,
}: {
  open: boolean
  shown: Option.Option<ShownAgent>
  canAct: boolean
  canPin: boolean
  onRename: (label: Option.Option<string>) => void
  onPin: (pinned: boolean) => void
  onClose: (confirmed: boolean) => void
  onDismiss: () => void
}) {
  return (
    <Sheet
      open={open}
      onClose={onDismiss}
      openerGone={Option.exists(shown, ({ view }) => Option.isNone(view.card))}
      title={Option.match(shown, {
        onNone: () => '',
        onSome: ({ card }) => agentTitleOrPane(card.row),
      })}
      description={Option.match(shown, {
        onNone: () => '',
        onSome: ({ view, card }) => (
          <span className="font-mono text-xs">
            {Option.match(view.herdMachine, {
              onNone: () => view.session.agent.machine,
              onSome: (entry) => entry.machine.label,
            })}{' '}
            · {card.workspace} · {card.tab}
          </span>
        ),
      })}
    >
      {Option.match(shown, {
        onNone: () => null,
        onSome: ({ view, card }) => {
          const confirming = closeNeedsConfirmation(card.row, view.close, view.session.close)
          const closing = isInFlightOrDone(view.close)

          return (
            <div
              key={toGlobalPaneId(view.session.agent.machine, view.session.agent.pane)}
              className="grid gap-2"
            >
              <RenameField
                row={card.row}
                progress={view.rename}
                disabled={!canAct}
                onRename={onRename}
              />
              <Button
                variant="secondary"
                size="touch"
                className={SHEET_ACTION}
                disabled={!canPin || isInFlightOrDone(view.pin)}
                onClick={() => {
                  onPin(!card.pinned)
                }}
              >
                {card.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                {card.pinned ? 'Unpin' : 'Pin to top'}
              </Button>
              <ActionFailure message={failureOf(view.pin)} />
              {confirming ? (
                <p
                  data-slot="close-confirmation"
                  className="text-muted-foreground mt-2 text-sm leading-5"
                >
                  crook didn't open this pane. Closing it ends whatever runs there, not just Claude.
                </p>
              ) : null}
              <HoldButton
                disabled={!canAct || closing}
                className={cn('w-full text-base', !confirming && 'mt-2')}
                completeLabel={CLOSING_LABEL}
                onComplete={() => {
                  onClose(confirming)
                }}
              >
                {holdLabel({ closing, confirming })}
              </HoldButton>
              <ActionFailure message={failureOf(view.close)} />
            </div>
          )
        },
      })}
    </Sheet>
  )
}

export function AgentActions() {
  const view = useAtomValue(agentActionsViewAtom)
  const views = useAtomValue(agentActionsViewsAtom)
  const dispatch = useAtomSet(agentActionsAtom)
  const toast = useAtomSet(toastAtom)
  const connection = useAtomValue(connectionAtom)
  const registry = React.useContext(RegistryContext)
  const router = useRouter()
  const shown = useShownAgent(view)
  const machineOnline = Option.exists(view, (current) => current.machineOnline)

  const showPaneClosed = () => {
    toast(ToastIntent.Show({ text: PANE_CLOSED_NOTICE }))
  }

  const isOnChatOf = (agent: PaneAddress) =>
    router.state.location.pathname ===
    router.buildLocation({
      to: '/m/$machine/p/$pane',
      params: { machine: agent.machine, pane: agent.pane },
    }).pathname

  const goToHerd = () =>
    Effect.runCallback(
      leaveForHerd(router).pipe(
        Effect.andThen(
          Effect.sync(() => {
            showPaneClosed()

            if (Option.isNone(registry.get(agentActionsViewAtom))) {
              restoreFocus(null)
            }
          }),
        ),
      ),
    )

  React.useEffect(() => {
    for (const current of views) {
      const finish = () => {
        dispatch(ActionsIntent.Finish({ agent: current.session.agent }))
      }

      SheetOutcome.$match(current.outcome, {
        Stay: () => undefined,
        Finished: finish,
        Closed: () => {
          finish()

          if (current.session.origin !== 'chat') {
            return
          }

          if (isOnChatOf(current.session.agent)) {
            goToHerd()
          } else {
            showPaneClosed()
          }
        },
        Ended: ({ notice }) => {
          finish()
          toast(ToastIntent.Show({ text: notice }))
        },
      })
    }
  }, [views])

  return (
    <AgentActionsSheet
      open={Option.isSome(view) && Option.isSome(shown)}
      shown={shown}
      canAct={connection.controlsEnabled && machineOnline}
      canPin={connection.controlsEnabled}
      onRename={(label) => {
        dispatch(ActionsIntent.Rename({ label }))
      }}
      onPin={(pinned) => {
        dispatch(ActionsIntent.Pin({ pinned }))
      }}
      onClose={(confirmed) => {
        dispatch(ActionsIntent.Close({ confirmed }))
      }}
      onDismiss={() => {
        dispatch(ActionsIntent.Dismiss())
      }}
    />
  )
}
