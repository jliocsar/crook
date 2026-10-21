import { useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import { useRouter } from '@tanstack/react-router'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import { Pencil, Pin, PinOff } from 'lucide-react'
import * as React from 'react'

import { type AgentRow, agentTitle, agentTitleOrPane } from '@crook/domain/AgentRow'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import {
  type ActionProgress,
  failureOf,
  isConfirmationAsked,
  isUnderway,
  keepsName,
  labelFromInput,
  PANE_CLOSED_NOTICE,
  SheetOutcome,
  sheetOutcome,
} from '@crook/web/actions/PaneActions'
import {
  ActionsIntent,
  agentActionsAtom,
  agentActionsViewAtom,
  PaneAddress,
} from '@crook/web/atoms/AgentActions'
import type { ActionsOrigin, AgentActionsView } from '@crook/web/atoms/AgentActions'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { ToastIntent, toastAtom } from '@crook/web/atoms/Toast'
import { Sheet } from '@crook/web/components/Sheet'
import { Button } from '@crook/web/components/ui/button'
import { HoldButton } from '@crook/web/components/ui/hold-button'
import type { AgentCardModel } from '@crook/web/herd/HerdLayout'
import { restoreFocus } from '@crook/web/navigation/Focus'

export type OpenAgentActions = (machine: MachineId, pane: PaneId, origin: ActionsOrigin) => void

interface ShownAgent {
  readonly view: AgentActionsView
  readonly card: AgentCardModel
}

const HERD_PATH = '/'

const FIELD =
  'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/35 placeholder:text-muted-foreground h-11 w-full min-w-0 rounded-lg border px-3 text-base outline-none focus-visible:ring-3'

const SHEET_ACTION = 'w-full justify-start text-base'

const holdLabel = ({ closing, confirming }: { closing: boolean; confirming: boolean }) => {
  if (closing) {
    return 'Closing…'
  }

  return confirming ? 'Hold to close anyway' : 'Hold to close agent'
}

export const useOpenAgentActions = (): OpenAgentActions => {
  const dispatch = useAtomSet(agentActionsAtom)

  return (machine, pane, origin) => {
    dispatch(ActionsIntent.Open({ agent: new PaneAddress({ machine, pane }), origin }))
  }
}

const useLastSome = <Value,>(value: Option.Option<Value>): Option.Option<Value> => {
  const last = React.useRef(value)

  if (Option.isSome(value)) {
    last.current = value
  }

  return last.current
}

function ActionFailure({ message }: { message: Option.Option<string> }) {
  return Option.match(message, {
    onNone: () => null,
    onSome: (text) => (
      <p role="alert" className="text-destructive text-sm leading-5">
        {text}
      </p>
    ),
  })
}

function RenameField({
  row,
  progress,
  disabled,
  onRename,
}: {
  row: AgentRow
  progress: ActionProgress
  disabled: boolean
  onRename: (label: Option.Option<string>) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(() => agentTitle(row))
  const [invalid, setInvalid] = React.useState(Option.none<string>())
  const saving = isUnderway(progress)

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
        <input
          ref={(input) => {
            input?.focus({ preventScroll: true })
          }}
          value={draft}
          aria-label="Agent name"
          placeholder={row.title}
          className={FIELD}
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

export function AgentActionsSheet({
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
          const confirming = !card.row.createdByCrook || isConfirmationAsked(view.close)
          const closing = isUnderway(view.close)

          return (
            <div
              key={`${view.session.agent.machine}/${view.session.agent.pane}`}
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
                disabled={!canPin || isUnderway(view.pin)}
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
                className={confirming ? 'w-full text-base' : 'mt-2 w-full text-base'}
                completeLabel="Closing…"
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
  const dispatch = useAtomSet(agentActionsAtom)
  const toast = useAtomSet(toastAtom)
  const connection = useAtomValue(connectionAtom)
  const router = useRouter()
  const lastCard = useLastSome(Option.flatMap(view, (current) => current.card))
  const shown = useLastSome(
    Option.flatMap(view, (current) =>
      Option.map(
        Option.orElse(current.card, () => lastCard),
        (card): ShownAgent => ({ view: current, card }),
      ),
    ),
  )
  const machineOnline = Option.exists(view, (current) => current.machineOnline)

  const goToHerd = () =>
    Effect.runCallback(
      Effect.promise(() => router.navigate({ to: HERD_PATH, replace: true })).pipe(
        Effect.andThen(
          Effect.sync(() => {
            toast(ToastIntent.Show({ text: PANE_CLOSED_NOTICE }))
            restoreFocus(null)
          }),
        ),
      ),
    )

  React.useEffect(() => {
    if (Option.isNone(view)) {
      return
    }

    const current = view.value

    SheetOutcome.$match(
      sheetOutcome({
        present: Option.isSome(current.card),
        herdMachine: current.herdMachine,
        pane: current.session.agent.pane,
        rename: current.rename,
        close: current.close,
        pin: current.pin,
      }),
      {
        Stay: () => undefined,
        Finished: () => {
          dispatch(ActionsIntent.Dismiss())
        },
        Closed: () => {
          dispatch(ActionsIntent.Dismiss())

          if (current.session.origin === 'chat') {
            goToHerd()
          }
        },
        Ended: ({ notice }) => {
          dispatch(ActionsIntent.Dismiss())
          toast(ToastIntent.Show({ text: notice }))
        },
      },
    )
  }, [view])

  return (
    <AgentActionsSheet
      open={Option.isSome(view)}
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
