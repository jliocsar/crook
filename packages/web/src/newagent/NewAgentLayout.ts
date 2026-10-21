import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import {
  CreateWorktree,
  FolderPath,
  hasStarted,
  StartAgent,
  WorktreeBranch,
} from '@crook/domain/Command'
import type { AgentStarted, LaunchCommand } from '@crook/domain/Command'
import { mostRecentPlace } from '@crook/domain/HerdView'
import type { HerdMachine, HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { agentsIn } from '@crook/domain/MachineState'
import { byMostRecentUse } from '@crook/domain/Place'
import type { Place } from '@crook/domain/Place'

export type FolderChoice = Data.TaggedEnum<{
  Recent: { readonly place: Place }
  Typed: { readonly folder: string }
}>

export type BranchChoice = Data.TaggedEnum<{
  Checkout: Record<never, never>
  Worktree: { readonly branch: string }
}>

export interface Selection {
  readonly machine: MachineId
  readonly folder: Option.Option<FolderChoice>
  readonly branch: BranchChoice
}

export type StartsOn = Data.TaggedEnum<{
  NewWorktree: { readonly branch: string }
  Branch: { readonly branch: string }
}>

export type NewAgentBody = Data.TaggedEnum<{
  Loading: Record<never, never>
  NoMachines: Record<never, never>
  AllOffline: Record<never, never>
  MachineOffline: { readonly machine: string }
  PickFolder: { readonly machine: string }
  Starts: {
    readonly folder: string
    readonly folderName: string
    readonly machine: string
    readonly on: Option.Option<StartsOn>
  }
}>

export interface BranchChip {
  readonly label: string
  readonly isNew: boolean
}

export interface NewAgentChips {
  readonly machine: string
  readonly folder: Option.Option<string>
  readonly branch: Option.Option<BranchChip>
}

export interface StartedAgent {
  readonly machine: MachineId
  readonly pane: PaneId
}

export const FolderChoice = Data.taggedEnum<FolderChoice>()
export const BranchChoice = Data.taggedEnum<BranchChoice>()
export const StartsOn = Data.taggedEnum<StartsOn>()
export const NewAgentBody = Data.taggedEnum<NewAgentBody>()

const AGENT_KIND = 'claude'
const PATH_SEPARATOR = '/'
const BRANCH_WORD_SEPARATOR = '-'
const DETACHED_HEAD_LABEL = 'detached HEAD'
const UNKNOWN_CHECKOUT_LABEL = 'Checkout'
const TRAILING_SEPARATORS = /\/+$/u
const WHITESPACE_RUN = /\s+/u
const WHITESPACE_RUNS = /\s+/gu
const NOT_IN_A_SLUG = /[^a-z0-9\s-]/gu

const isOnline = (entry: HerdMachine) => entry.machine.connection === 'online'

const isFolderPath = Schema.is(FolderPath)

const isWorktreeBranch = Schema.is(WorktreeBranch)

export const findMachine = (view: HerdView, machine: MachineId): Option.Option<HerdMachine> =>
  Arr.findFirst(view.machines, (entry) => entry.machine.id === machine)

export const placesOn = (view: HerdView, machine: MachineId): readonly Place[] =>
  pipe(
    findMachine(view, machine),
    Option.flatMap((entry) => entry.state),
    Option.match({
      onNone: () => [],
      onSome: (state) => Arr.sort(state.places, byMostRecentUse),
    }),
  )

export const folderOf = (choice: FolderChoice): string =>
  FolderChoice.$match(choice, {
    Recent: ({ place }) => place.folder,
    Typed: ({ folder }) => folder,
  })

export const folderName = (folder: string): string =>
  pipe(
    folder.replace(TRAILING_SEPARATORS, ''),
    Str.split(PATH_SEPARATOR),
    Arr.last,
    Option.filter(Str.isNonEmpty),
    Option.getOrElse(() => folder),
  )

export const hasCheckout = (choice: FolderChoice): boolean =>
  FolderChoice.$match(choice, {
    Recent: ({ place }) => Option.isSome(place.checkout),
    Typed: () => true,
  })

export const checkoutLabel = (choice: FolderChoice): string =>
  FolderChoice.$match(choice, {
    Recent: ({ place }) =>
      pipe(
        place.checkout,
        Option.flatMap((checkout) => checkout.branch),
        Option.getOrElse(() => DETACHED_HEAD_LABEL),
      ),
    Typed: () => UNKNOWN_CHECKOUT_LABEL,
  })

export const slugBranch = (task: string): string =>
  pipe(
    Str.split(task, '\n'),
    Arr.head,
    Option.getOrElse(() => ''),
    Str.toLowerCase,
    (line) => line.replace(NOT_IN_A_SLUG, ' '),
    Str.split(WHITESPACE_RUN),
    Arr.filter(Str.isNonEmpty),
    Arr.join(BRANCH_WORD_SEPARATOR),
  )

export const cleanBranch = (typed: string): string =>
  typed.trim().replace(WHITESPACE_RUNS, BRANCH_WORD_SEPARATOR)

export const validBranch = (typed: string): Option.Option<string> =>
  Option.liftPredicate(cleanBranch(typed), isWorktreeBranch)

export const selectionOn = (view: HerdView, machine: MachineId): Selection => ({
  machine,
  folder: Option.map(Arr.head(placesOn(view, machine)), (place) => FolderChoice.Recent({ place })),
  branch: BranchChoice.Checkout(),
})

export const defaultSelection = (view: HerdView): Option.Option<Selection> =>
  pipe(
    mostRecentPlace(view),
    Option.map(({ machine, place }): Selection => ({
      machine,
      folder: Option.some(FolderChoice.Recent({ place })),
      branch: BranchChoice.Checkout(),
    })),
    Option.orElse(() =>
      pipe(
        Arr.findFirst(view.machines, isOnline),
        Option.map((entry) => selectionOn(view, entry.machine.id)),
      ),
    ),
  )

const refreshedFolder = (view: HerdView, machine: MachineId, choice: FolderChoice): FolderChoice =>
  pipe(
    Arr.findFirst(placesOn(view, machine), (place) => place.folder === folderOf(choice)),
    Option.match({
      onNone: () => choice,
      onSome: (place) => FolderChoice.Recent({ place }),
    }),
  )

export const currentSelection = (
  view: HerdView,
  chosen: Option.Option<Selection>,
): Option.Option<Selection> =>
  pipe(
    chosen,
    Option.filter((selection) => Option.isSome(findMachine(view, selection.machine))),
    Option.map((selection): Selection => ({
      ...selection,
      folder: Option.map(selection.folder, (choice) =>
        refreshedFolder(view, selection.machine, choice),
      ),
    })),
    Option.orElse(() => defaultSelection(view)),
  )

export const typedFolder = (
  view: HerdView,
  machine: MachineId,
  typed: string,
): Option.Option<FolderChoice> =>
  pipe(
    Option.liftPredicate(typed.trim(), isFolderPath),
    Option.map((folder) => refreshedFolder(view, machine, FolderChoice.Typed({ folder }))),
  )

export const isOnlineMachine = (view: HerdView, machine: MachineId): boolean =>
  Option.exists(findMachine(view, machine), isOnline)

const taskOf = (task: string): Option.Option<string> =>
  Option.liftPredicate(task.trim(), Str.isNonEmpty)

const worktreeBranchOf = (selection: Selection, choice: FolderChoice): Option.Option<string> =>
  hasCheckout(choice)
    ? BranchChoice.$match(selection.branch, {
        Checkout: () => Option.none(),
        Worktree: ({ branch }) => Option.some(branch),
      })
    : Option.none()

export const launchCommand = (selection: Selection, task: string): Option.Option<LaunchCommand> =>
  Option.flatMap(selection.folder, (choice) =>
    pipe(
      Option.liftPredicate(folderOf(choice), isFolderPath),
      Option.flatMap((folder) =>
        Option.match(worktreeBranchOf(selection, choice), {
          onNone: () =>
            Option.some<LaunchCommand>(
              new StartAgent({ kind: AGENT_KIND, folder, task: taskOf(task) }),
            ),
          onSome: (typed) =>
            Option.map(
              validBranch(typed),
              (branch): LaunchCommand =>
                new CreateWorktree({ kind: AGENT_KIND, folder, branch, task: taskOf(task) }),
            ),
        }),
      ),
    ),
  )

const startsOn = (selection: Selection, choice: FolderChoice): Option.Option<StartsOn> =>
  Option.match(worktreeBranchOf(selection, choice), {
    onNone: () =>
      FolderChoice.$match(choice, {
        Recent: ({ place }) =>
          pipe(
            place.checkout,
            Option.flatMap((checkout) => checkout.branch),
            Option.map((branch) => StartsOn.Branch({ branch })),
          ),
        Typed: () => Option.none(),
      }),
    onSome: (typed) => Option.some(StartsOn.NewWorktree({ branch: cleanBranch(typed) })),
  })

const bodyOn = (entry: HerdMachine, selection: Selection): NewAgentBody => {
  const machine = entry.machine.label

  if (!isOnline(entry)) {
    return NewAgentBody.MachineOffline({ machine })
  }

  return Option.match(selection.folder, {
    onNone: () => NewAgentBody.PickFolder({ machine }),
    onSome: (choice) =>
      NewAgentBody.Starts({
        folder: folderOf(choice),
        folderName: folderName(folderOf(choice)),
        machine,
        on: startsOn(selection, choice),
      }),
  })
}

export const newAgentBody = (
  view: Option.Option<HerdView>,
  selection: Option.Option<Selection>,
): NewAgentBody =>
  Option.match(view, {
    onNone: () => NewAgentBody.Loading(),
    onSome: (herd) =>
      pipe(
        selection,
        Option.flatMap((chosen) =>
          Option.map(findMachine(herd, chosen.machine), (entry) => bodyOn(entry, chosen)),
        ),
        Option.getOrElse(() =>
          Arr.isReadonlyArrayEmpty(herd.machines)
            ? NewAgentBody.NoMachines()
            : NewAgentBody.AllOffline(),
        ),
      ),
  })

const branchChip = (selection: Selection, choice: FolderChoice): Option.Option<BranchChip> =>
  Option.liftPredicate(
    Option.match(worktreeBranchOf(selection, choice), {
      onNone: () => ({ label: checkoutLabel(choice), isNew: false }),
      onSome: (typed) => ({ label: `new: ${cleanBranch(typed)}`, isNew: true }),
    }),
    () => hasCheckout(choice),
  )

export const newAgentChips = (view: HerdView, selection: Selection): Option.Option<NewAgentChips> =>
  Option.map(findMachine(view, selection.machine), (entry) => ({
    machine: entry.machine.label,
    folder: Option.map(selection.folder, (choice) => folderName(folderOf(choice))),
    branch: Option.flatMap(selection.folder, (choice) => branchChip(selection, choice)),
  }))

export const startedAgent = (
  view: HerdView,
  machine: MachineId,
  receipt: AgentStarted,
): Option.Option<StartedAgent> =>
  pipe(
    findMachine(view, machine),
    Option.filter((entry) => hasStarted(receipt, agentsIn(entry.state))),
    Option.map(() => ({ machine, pane: receipt.pane })),
  )
