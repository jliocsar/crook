import { useAtom, useAtomValue } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import * as Cause from 'effect/Cause'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import type { HerdView } from '@crook/domain/HerdView'
import type { PaneId } from '@crook/domain/Ids'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { herdAtom } from '@crook/web/atoms/Herd'
import { LaunchAttempt, launchAtom } from '@crook/web/atoms/Launch'
import type { LaunchFailure } from '@crook/web/atoms/Launch'
import { Dimmed } from '@crook/web/components/Dimmed'
import { Sheet } from '@crook/web/components/Sheet'
import { Button } from '@crook/web/components/ui/button'
import { Spinner } from '@crook/web/components/ui/spinner'
import { PushedHeader, PushedScreen } from '@crook/web/navigation/PushedScreen'
import { mintIdempotencyKey, retryKey } from '@crook/web/newagent/LaunchKey'
import { LaunchSummary } from '@crook/web/newagent/LaunchSummary'
import {
  BranchChoice,
  checkoutLabel,
  currentSelection,
  FolderChoice,
  folderOf,
  isOnlineMachine,
  launchCommand,
  newAgentBody,
  newAgentChips,
  placesOn,
  selectionOn,
  slugBranch,
  startedAgent,
  typedFolder,
} from '@crook/web/newagent/NewAgentLayout'
import type { Selection, StartedAgent } from '@crook/web/newagent/NewAgentLayout'
import { BranchChoices, FolderChoices, MachineChoices } from '@crook/web/newagent/Pickers'
import { PlaceChips } from '@crook/web/newagent/PlaceChips'
import type { Picker } from '@crook/web/newagent/PlaceChips'
import { TaskComposer } from '@crook/web/newagent/TaskComposer'
import { useNow } from '@crook/web/time/Now'

type LaunchResult = AsyncResult.AsyncResult<unknown, LaunchFailure>

const PICKER_TITLE = {
  machine: 'Machine',
  folder: 'Folder',
  branch: 'Branch',
} satisfies Record<Picker, string>

const STATUS_SPINNER_SIZE = 14

const settledCause = (result: LaunchResult) =>
  pipe(
    Option.liftPredicate(result, (current) => !AsyncResult.isWaiting(current)),
    Option.flatMap(AsyncResult.cause),
    Option.filter((cause) => !Cause.hasInterruptsOnly(cause)),
  )

const failureOf = (result: LaunchResult): Option.Option<LaunchFailure> =>
  Option.flatMap(settledCause(result), Cause.findErrorOption)

const failureMessage = (result: LaunchResult): Option.Option<string> =>
  Option.map(settledCause(result), (cause) =>
    Option.match(Cause.findErrorOption(cause), {
      onNone: () => Cause.pretty(cause),
      onSome: (error) => error.message,
    }),
  )

const paneLeftRunning = (failure: LaunchFailure): Option.Option<PaneId> =>
  Match.value(failure).pipe(
    Match.tag('TaskNotDelivered', (refusal) => Option.some(refusal.pane)),
    Match.orElse(() => Option.none()),
  )

const worktreeOf = (selection: Selection): Option.Option<string> =>
  BranchChoice.$match(selection.branch, {
    Checkout: () => Option.none(),
    Worktree: ({ branch }) => Option.some(branch),
  })

function LaunchStatus({ text }: { text: string }) {
  return (
    <p
      role="status"
      className="text-muted-foreground flex items-center justify-center gap-2 text-sm leading-5"
    >
      <Spinner size={STATUS_SPINNER_SIZE} />
      {text}
    </p>
  )
}

function LaunchFailureNotice({
  message,
  onOpenChat,
}: {
  message: string
  onOpenChat: Option.Option<() => void>
}) {
  return (
    <div className="grid gap-1">
      <p role="alert" className="text-destructive text-sm leading-5">
        {message}
      </p>
      {Option.match(onOpenChat, {
        onNone: () => null,
        onSome: (open) => (
          <Button variant="secondary" size="touch" onClick={open}>
            Open the chat
          </Button>
        ),
      })}
    </div>
  )
}

function PickerContent({
  picker,
  view,
  selection,
  task,
  onClose,
  onChange,
}: {
  picker: Picker
  view: HerdView
  selection: Selection
  task: string
  onClose: () => void
  onChange: (next: Selection, close: boolean) => void
}) {
  const now = useNow()
  const worktree = worktreeOf(selection)

  return Match.value(picker).pipe(
    Match.when('machine', () => (
      <MachineChoices
        machines={view.machines}
        now={now}
        selected={selection.machine}
        onPick={(entry) => {
          onChange(selectionOn(view, entry.machine.id), true)
        }}
      />
    )),
    Match.when('folder', () => (
      <FolderChoices
        places={placesOn(view, selection.machine)}
        selected={Option.map(selection.folder, folderOf)}
        validPath={(typed) => Option.isSome(typedFolder(view, selection.machine, typed))}
        onPick={(place) => {
          onChange(
            {
              ...selection,
              folder: Option.some(FolderChoice.Recent({ place })),
              branch: BranchChoice.Checkout(),
            },
            true,
          )
        }}
        onType={(typed) => {
          onChange(
            {
              ...selection,
              folder: typedFolder(view, selection.machine, typed),
              branch: BranchChoice.Checkout(),
            },
            true,
          )
        }}
      />
    )),
    Match.when('branch', () =>
      Option.match(selection.folder, {
        onNone: () => null,
        onSome: (choice) => (
          <BranchChoices
            checkout={checkoutLabel(choice)}
            worktree={worktree}
            onCheckout={() => {
              onChange({ ...selection, branch: BranchChoice.Checkout() }, true)
            }}
            onWorktree={() => {
              onChange(
                {
                  ...selection,
                  branch: BranchChoice.Worktree({
                    branch: Option.getOrElse(worktree, () => slugBranch(task)),
                  }),
                },
                false,
              )
            }}
            onWorktreeChange={(branch) => {
              onChange({ ...selection, branch: BranchChoice.Worktree({ branch }) }, false)
            }}
            onDone={onClose}
          />
        ),
      }),
    ),
    Match.exhaustive,
  )
}

function useOpenChat() {
  const navigate = useNavigate()

  return ({ machine, pane }: StartedAgent) => {
    void navigate({
      to: '/m/$machine/p/$pane',
      params: { machine, pane },
      replace: true,
      state: ({ openerKey }) => (openerKey === undefined ? {} : { openerKey }),
    })
  }
}

function NewAgentFlow() {
  const connection = useAtomValue(connectionAtom)
  const herd = useAtomValue(herdAtom)
  const [result, launch] = useAtom(launchAtom)
  const openChat = useOpenChat()
  const [chosen, setChosen] = React.useState(Option.none<Selection>())
  const [task, setTask] = React.useState('')
  const [picker, setPicker] = React.useState<Picker>('machine')
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [attempt, setAttempt] = React.useState(Option.none<LaunchAttempt>())
  const opened = React.useRef(false)

  const view = Option.map(herd, (snapshot) => snapshot.view)
  const selection = Option.flatMap(view, (herdView) => currentSelection(herdView, chosen))
  const shown = Option.all({ herdView: view, current: selection })
  const pending = AsyncResult.isWaiting(result)
  const receipt = AsyncResult.isSuccess(result) ? Option.some(result.value) : Option.none()
  const started = pipe(
    Option.all({ herdView: view, sent: attempt, answer: receipt }),
    Option.flatMap(({ herdView, sent, answer }) => startedAgent(herdView, sent.machine, answer)),
  )
  const busy = pending || Option.isSome(receipt)
  const online = Option.exists(shown, ({ herdView, current }) =>
    isOnlineMachine(herdView, current.machine),
  )
  const commandFor = (text: string) =>
    Option.flatMap(selection, (current) =>
      Option.map(launchCommand(current, text), (command) => ({
        machine: current.machine,
        command,
      })),
    )
  const ready = connection.controlsEnabled && online && !busy && Option.isSome(commandFor(''))
  const taskLeftUndelivered = pipe(
    failureOf(result),
    Option.flatMap(paneLeftRunning),
    Option.flatMap((pane) =>
      Option.map(attempt, (sent): StartedAgent => ({ machine: sent.machine, pane })),
    ),
  )

  React.useEffect(() => {
    if (Option.isNone(chosen) && Option.isSome(selection)) {
      setChosen(selection)
    }
  }, [chosen, selection])

  React.useEffect(() => {
    if (Option.isSome(started) && !opened.current) {
      opened.current = true
      openChat(started.value)
    }
  }, [started, openChat])

  const start = (text: string) => {
    Option.map(commandFor(text), ({ machine, command }) => {
      const key = Option.getOrElse(
        retryKey(attempt, failureOf(result), machine, command),
        mintIdempotencyKey,
      )
      const next = new LaunchAttempt({ key, machine, command })

      setAttempt(Option.some(next))
      launch(next)
    })
  }

  return (
    <>
      <PushedHeader title="New agent" backLabel="Back to Agents" />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="no-scrollbar flex h-full flex-col justify-center overflow-y-auto px-4 pb-4">
          <Dimmed dimmed={connection.stale}>
            <LaunchSummary body={newAgentBody(view, selection)} />
          </Dimmed>
        </div>
      </div>
      <div
        data-slot="new-agent-dock"
        className="border-border bg-card relative z-30 grid grid-cols-1 gap-2 border-t px-4 pt-3 pb-[max(0.75rem,var(--safe-bottom))]"
      >
        {Option.match(
          Option.flatMap(shown, ({ herdView, current }) => newAgentChips(herdView, current)),
          {
            onNone: () => null,
            onSome: (chips) => (
              <fieldset disabled={busy || !connection.controlsEnabled} className="contents">
                <PlaceChips
                  chips={chips}
                  onOpen={(next) => {
                    setPicker(next)
                    setPickerOpen(true)
                  }}
                />
              </fieldset>
            ),
          },
        )}
        {pending ? <LaunchStatus text="Starting Claude…" /> : null}
        {Option.isSome(receipt) ? <LaunchStatus text="Opening the chat…" /> : null}
        {Option.match(failureMessage(result), {
          onNone: () => null,
          onSome: (message) => (
            <LaunchFailureNotice
              message={message}
              onOpenChat={Option.map(taskLeftUndelivered, (agent) => () => {
                openChat(agent)
              })}
            />
          ),
        })}
        <TaskComposer
          task={task}
          disabled={busy}
          canSend={ready}
          sending={pending}
          onTaskChange={setTask}
          onSend={() => {
            start(task)
          }}
        />
        <Button
          variant="ghost"
          size="touch"
          disabled={!ready}
          className="text-muted-foreground text-sm"
          onClick={() => {
            start('')
          }}
        >
          Start without a task
        </Button>
      </div>
      {Option.match(shown, {
        onNone: () => null,
        onSome: ({ herdView, current }) => (
          <Sheet
            open={pickerOpen}
            title={PICKER_TITLE[picker]}
            onClose={() => {
              setPickerOpen(false)
            }}
          >
            <PickerContent
              picker={picker}
              view={herdView}
              selection={current}
              task={task}
              onClose={() => {
                setPickerOpen(false)
              }}
              onChange={(next, close) => {
                setChosen(Option.some(next))

                if (close) {
                  setPickerOpen(false)
                }
              }}
            />
          </Sheet>
        ),
      })}
    </>
  )
}

export function NewAgentScreen() {
  return (
    <PushedScreen>
      <NewAgentFlow />
    </PushedScreen>
  )
}
