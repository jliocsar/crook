import { useAtomValue } from '@effect/atom-react/Hooks'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as React from 'react'

import type { HerdView } from '@crook/domain/HerdView'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { allowsActions, dimsContent, isVerified } from '@crook/web/connection/ConnectionView'
import { herdViewAtom } from '@crook/web/atoms/Herd'
import { Dimmed } from '@crook/web/components/Dimmed'
import { Sheet } from '@crook/web/components/Sheet'
import { Button } from '@crook/web/components/ui/button'
import { Spinner } from '@crook/web/components/ui/spinner'
import { isOnlineMachine } from '@crook/web/herd/HerdLayout'
import { PushedHeader, PushedScreen } from '@crook/web/navigation/PushedScreen'
import { useLaunch } from '@crook/web/newagent/Launch'
import { LaunchSummary } from '@crook/web/newagent/LaunchSummary'
import {
  checkoutLabel,
  currentSelection,
  FolderChoice,
  folderOf,
  launchCommand,
  newAgentBody,
  newAgentChips,
  placesOn,
  selectionOn,
  typedFolder,
  withFolder,
  withWorktree,
  withWorktreeBranch,
  worktreeBranch,
} from '@crook/web/newagent/NewAgentLayout'
import type { Selection } from '@crook/web/newagent/NewAgentLayout'
import { BranchChoices, FolderChoices, MachineChoices } from '@crook/web/newagent/Pickers'
import { PlaceChips } from '@crook/web/newagent/PlaceChips'
import type { Picker } from '@crook/web/newagent/PlaceChips'
import { TaskComposer } from '@crook/web/newagent/TaskComposer'
import { useNow } from '@crook/web/time/Now'

const PICKER_TITLE = {
  machine: 'Machine',
  folder: 'Folder',
  branch: 'Branch',
} satisfies Record<Picker, string>

const STATUS_SPINNER_SIZE = 14

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

function OpenChatButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button variant="secondary" size="touch" onClick={onOpen}>
      Open the chat
    </Button>
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
        onSome: (open) => <OpenChatButton onOpen={open} />,
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
  const worktree = worktreeBranch(selection, task)

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
          onChange(withFolder(selection, Option.some(FolderChoice.Recent({ place }))), true)
        }}
        onType={(typed) => {
          onChange(withFolder(selection, typedFolder(view, selection.machine, typed)), true)
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
              onChange(withFolder(selection, selection.folder), true)
            }}
            onWorktree={() => {
              onChange(withWorktree(selection), false)
            }}
            onWorktreeChange={(branch) => {
              onChange(withWorktreeBranch(selection, branch), false)
            }}
            onDone={onClose}
          />
        ),
      }),
    ),
    Match.exhaustive,
  )
}

function NewAgentFlow() {
  const connection = useAtomValue(connectionAtom)
  const view = useAtomValue(herdViewAtom)
  const [chosen, setChosen] = React.useState(Option.none<Selection>())
  const [task, setTask] = React.useState('')
  const [picker, setPicker] = React.useState<Picker>('machine')
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [editedSinceStart, setEditedSinceStart] = React.useState(false)

  const launch = useLaunch()
  const selection = Option.flatMap(view, (herdView) => currentSelection(herdView, chosen))
  const shown = Option.all({ herdView: view, current: selection })
  const busy = launch.pending || Option.isSome(launch.opening)
  const online = Option.exists(shown, ({ herdView, current }) =>
    isOnlineMachine(herdView, current.machine),
  )
  const commandFor = (text: string) =>
    Option.flatMap(selection, (current) =>
      Option.map(launchCommand(current, task, text), (command) => ({
        machine: current.machine,
        command,
      })),
    )
  const restartBlocked = launch.blocksRestart && !editedSinceStart
  const ready =
    allowsActions(connection) && online && !busy && !restartBlocked && Option.isSome(commandFor(''))

  React.useEffect(() => {
    if (Option.isNone(chosen) && Option.isSome(selection) && isVerified(connection)) {
      setChosen(selection)
    }
  }, [chosen, selection, connection])

  const start = (text: string) => {
    const next = commandFor(text)

    if (Option.isSome(next)) {
      setEditedSinceStart(false)
      launch.start(next.value.machine, next.value.command)
    }
  }

  return (
    <>
      <PushedHeader title="New agent" backLabel="Back to Agents" />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="no-scrollbar flex h-full flex-col justify-center overflow-y-auto px-4 pb-4">
          <Dimmed dimmed={dimsContent(connection)}>
            <LaunchSummary body={newAgentBody(view, selection, task)} />
          </Dimmed>
        </div>
      </div>
      <div
        data-slot="new-agent-dock"
        className="border-border bg-card relative z-30 grid grid-cols-1 gap-2 border-t px-4 pt-3 pb-[max(0.75rem,var(--safe-bottom))] in-data-[keyboard=open]:pb-3"
      >
        {Option.match(
          Option.flatMap(shown, ({ herdView, current }) => newAgentChips(herdView, current, task)),
          {
            onNone: () => null,
            onSome: (chips) => (
              <fieldset disabled={busy || !allowsActions(connection)} className="contents">
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
        {launch.pending || Option.isSome(launch.opening) ? (
          <div className="grid gap-1">
            <LaunchStatus text={launch.pending ? 'Starting Claude…' : 'Opening the chat…'} />
            {Option.match(launch.opening, {
              onNone: () => null,
              onSome: (open) => <OpenChatButton onOpen={open} />,
            })}
          </div>
        ) : null}
        {Option.match(launch.failure, {
          onNone: () => null,
          onSome: (message) => (
            <LaunchFailureNotice message={message} onOpenChat={launch.openChatAfterFailure} />
          ),
        })}
        <TaskComposer
          task={task}
          disabled={busy}
          canSend={ready}
          sending={launch.pending}
          onTaskChange={(next) => {
            setTask(next)
            setEditedSinceStart(true)
          }}
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
                setEditedSinceStart(true)

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
