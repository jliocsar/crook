import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'

import { AgentStarted, CreateWorktree, StartAgent } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import { Checkout, Place } from '@crook/domain/Place'
import {
  BranchChoice,
  cleanBranch,
  currentSelection,
  defaultSelection,
  folderName,
  FolderChoice,
  launchCommand,
  NewAgentBody,
  newAgentChips,
  selectionOn,
  slugBranch,
  startedAgent,
  StartsOn,
  typedFolder,
  validBranch,
  withFolder,
  withWorktree,
  withWorktreeBranch,
} from '@crook/web/newagent/NewAgentLayout'
import type { Selection } from '@crook/web/newagent/NewAgentLayout'
import { newAgentBody } from '@crook/web/newagent/NewAgentLayout'

import { agent, DESK, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'

const CROOK = '/home/jliocsar/Projects/crook'
const DOTFILES = '/home/jliocsar/dotfiles'
const SCRATCH = '/home/jliocsar/scratch'

const place = (folder: string, minutesAgo: number, checkout: Option.Option<Checkout>) =>
  new Place({
    folder,
    checkout,
    usedAt: DateTime.subtractDuration(START, Duration.minutes(minutesAgo)),
  })

const onBranch = (branch: string) => Option.some(new Checkout({ branch: Option.some(branch) }))

const crook = place(CROOK, 5, onBranch('main'))
const dotfiles = place(DOTFILES, 1, onBranch('master'))
const scratch = place(SCRATCH, 30, Option.none())

const laptop = machine(LAPTOP, [agent('w1:p1', 'working')], { places: [crook, scratch] })
const desk = machine(DESK, [], { places: [dotfiles] })
const offlineDesk = machine(DESK, [], { connection: 'offline', places: [dotfiles] })

const inCrook: Selection = {
  machine: LAPTOP,
  folder: Option.some(FolderChoice.Recent({ place: crook })),
  branch: BranchChoice.Checkout(),
}

describe('defaultSelection', () => {
  it('picks the most recent place on an online machine', () => {
    expect(defaultSelection(herd([laptop, desk]))).toEqual(
      Option.some({
        machine: DESK,
        folder: Option.some(FolderChoice.Recent({ place: dotfiles })),
        branch: BranchChoice.Checkout(),
      }),
    )
    expect(defaultSelection(herd([laptop, offlineDesk]))).toEqual(Option.some(inCrook))
  })

  it('falls back to an online machine without places, then to nothing', () => {
    const bare = machine(LAPTOP, [])

    expect(defaultSelection(herd([offlineDesk, bare]))).toEqual(
      Option.some({ machine: LAPTOP, folder: Option.none(), branch: BranchChoice.Checkout() }),
    )
    expect(defaultSelection(herd([offlineDesk]))).toEqual(Option.none())
  })
})

describe('currentSelection', () => {
  it('keeps what was chosen while its machine is in the herd, else takes the default', () => {
    const onDesk = selectionOn(herd([laptop, desk]), DESK)

    expect(currentSelection(herd([laptop, desk]), Option.some(onDesk))).toEqual(Option.some(onDesk))
    expect(currentSelection(herd([laptop]), Option.some(onDesk))).toEqual(Option.some(inCrook))
  })

  it('shows the branch a chosen folder has now', () => {
    const moved = place(CROOK, 5, onBranch('feat/jc-111-brief'))
    const later = herd([machine(LAPTOP, [], { places: [moved] })])

    expect(currentSelection(later, Option.some(inCrook))).toEqual(
      Option.some({ ...inCrook, folder: Option.some(FolderChoice.Recent({ place: moved })) }),
    )
  })
})

describe('selection changes', () => {
  it('starts a new folder on its checkout', () => {
    const named = { ...inCrook, branch: BranchChoice.Worktree({ typed: Option.some('fix-x') }) }
    const inScratch = Option.some(FolderChoice.Recent({ place: scratch }))

    expect(withFolder(named, inScratch)).toEqual({ ...inCrook, folder: inScratch })
    expect(withFolder(named, Option.none())).toEqual({ ...inCrook, folder: Option.none() })
  })

  it('keeps a worktree branch already named, and drops it for the checkout', () => {
    const unnamed = { ...inCrook, branch: BranchChoice.Worktree({ typed: Option.none() }) }
    const named = withWorktreeBranch(unnamed, 'fix-x')

    expect(withWorktree(inCrook)).toEqual(unnamed)
    expect(named).toEqual({
      ...inCrook,
      branch: BranchChoice.Worktree({ typed: Option.some('fix-x') }),
    })
    expect(withWorktree(named)).toEqual(named)
    expect(withFolder(named, named.folder)).toEqual(inCrook)
  })
})

describe('typedFolder', () => {
  it('takes an absolute path, matching a known place when there is one', () => {
    const view = herd([laptop])

    expect(typedFolder(view, LAPTOP, `  ${CROOK} `)).toEqual(
      Option.some(FolderChoice.Recent({ place: crook })),
    )
    expect(typedFolder(view, LAPTOP, '/srv/hub')).toEqual(
      Option.some(FolderChoice.Typed({ folder: '/srv/hub' })),
    )
    expect(typedFolder(view, LAPTOP, '~/Projects/crook')).toEqual(Option.none())
  })

  it('drops trailing separators, so a typed path still finds its place', () => {
    const view = herd([laptop])

    expect(typedFolder(view, LAPTOP, `${CROOK}//`)).toEqual(
      Option.some(FolderChoice.Recent({ place: crook })),
    )
    expect(typedFolder(view, LAPTOP, '/')).toEqual(Option.some(FolderChoice.Typed({ folder: '/' })))
  })
})

describe('branch names', () => {
  it('suggests a lowercase slug of the first line of the task', () => {
    expect(slugBranch('Fix the herd’s banner, again!\nThen run the gate')).toBe(
      'fix-the-herd-s-banner-again',
    )
    expect(slugBranch('')).toBe('')
  })

  it('never suggests a name that starts with a dash or repeats one', () => {
    expect(slugBranch('- Fix the banner')).toBe('fix-the-banner')
    expect(slugBranch('fix -- the -banner-')).toBe('fix-the-banner')
  })

  it('turns typed spaces into dashes and refuses an empty name', () => {
    expect(cleanBranch('  fix the banner ')).toBe('fix-the-banner')
    expect(validBranch('feat/jc 111')).toEqual(Option.some('feat/jc-111'))
    expect(validBranch('   ')).toEqual(Option.none())
  })

  it('names a folder by its last segment', () => {
    expect(folderName(CROOK)).toBe('crook')
    expect(folderName(`${CROOK}/`)).toBe('crook')
    expect(folderName('/')).toBe('/')
  })
})

describe('launchCommand', () => {
  it('starts Claude in the folder, with the trimmed task or none', () => {
    expect(launchCommand(inCrook, '', '  Fix the banner \n')).toEqual(
      Option.some(
        new StartAgent({ kind: 'claude', folder: CROOK, task: Option.some('Fix the banner') }),
      ),
    )
    expect(launchCommand(inCrook, '', '   ')).toEqual(
      Option.some(new StartAgent({ kind: 'claude', folder: CROOK, task: Option.none() })),
    )
  })

  it('makes a worktree when one is asked for in a checkout', () => {
    const worktree = {
      ...inCrook,
      branch: BranchChoice.Worktree({ typed: Option.some('fix banner') }),
    }

    expect(launchCommand(worktree, 'Fix the banner', 'Fix the banner')).toEqual(
      Option.some(
        new CreateWorktree({
          kind: 'claude',
          folder: CROOK,
          branch: 'fix-banner',
          task: Option.some('Fix the banner'),
        }),
      ),
    )
    expect(
      launchCommand(
        { ...worktree, branch: BranchChoice.Worktree({ typed: Option.some(' ') }) },
        'Fix the banner',
        '',
      ),
    ).toEqual(Option.none())
  })

  it('names an untyped worktree branch after the draft, even when the task is not sent', () => {
    const suggested = { ...inCrook, branch: BranchChoice.Worktree({ typed: Option.none() }) }

    expect(launchCommand(suggested, 'Fix the banner', '')).toEqual(
      Option.some(
        new CreateWorktree({
          kind: 'claude',
          folder: CROOK,
          branch: 'fix-the-banner',
          task: Option.none(),
        }),
      ),
    )
    expect(launchCommand(suggested, '', '')).toEqual(Option.none())
  })

  it('starts nothing without a folder', () => {
    expect(launchCommand({ ...inCrook, folder: Option.none() }, '', 'Fix it')).toEqual(
      Option.none(),
    )
  })
})

describe('newAgentBody', () => {
  it('says where Claude starts', () => {
    const view = herd([laptop])

    expect(newAgentBody(Option.some(view), Option.some(inCrook), '')).toEqual(
      NewAgentBody.Starts({
        folder: CROOK,
        folderName: 'crook',
        machine: 'laptop',
        on: Option.some(StartsOn.Branch({ branch: 'main' })),
      }),
    )
    expect(
      newAgentBody(
        Option.some(view),
        Option.some({
          ...inCrook,
          branch: BranchChoice.Worktree({ typed: Option.some('fix-x') }),
        }),
        '',
      ),
    ).toEqual(
      NewAgentBody.Starts({
        folder: CROOK,
        folderName: 'crook',
        machine: 'laptop',
        on: Option.some(StartsOn.NewWorktree({ branch: 'fix-x' })),
      }),
    )
  })

  it('asks for a branch name while the new worktree has none', () => {
    const unnamed = { ...inCrook, branch: BranchChoice.Worktree({ typed: Option.none() }) }
    const view = Option.some(herd([laptop]))

    expect(newAgentBody(view, Option.some(unnamed), '')).toEqual(
      NewAgentBody.Starts({
        folder: CROOK,
        folderName: 'crook',
        machine: 'laptop',
        on: Option.some(StartsOn.UnnamedWorktree()),
      }),
    )
    expect(newAgentBody(view, Option.some(unnamed), 'Fix the banner')).toEqual(
      NewAgentBody.Starts({
        folder: CROOK,
        folderName: 'crook',
        machine: 'laptop',
        on: Option.some(StartsOn.NewWorktree({ branch: 'fix-the-banner' })),
      }),
    )
  })

  it('covers the empty cases', () => {
    expect(newAgentBody(Option.none(), Option.none(), '')).toEqual(NewAgentBody.Loading())
    expect(newAgentBody(Option.some(herd([])), Option.none(), '')).toEqual(
      NewAgentBody.NoMachines(),
    )
    expect(newAgentBody(Option.some(herd([offlineDesk])), Option.none(), '')).toEqual(
      NewAgentBody.AllOffline(),
    )
    expect(
      newAgentBody(
        Option.some(herd([offlineDesk])),
        Option.some(selectionOn(herd([desk]), DESK)),
        '',
      ),
    ).toEqual(NewAgentBody.MachineOffline({ machine: 'desk' }))
    expect(
      newAgentBody(
        Option.some(herd([machine(LAPTOP, [])])),
        Option.some({ ...inCrook, folder: Option.none() }),
        '',
      ),
    ).toEqual(NewAgentBody.PickFolder({ machine: 'laptop' }))
  })
})

describe('newAgentChips', () => {
  it('shows the branch chip only for a checkout, or a typed path', () => {
    const view = herd([laptop])
    const inScratch = {
      ...inCrook,
      folder: Option.some(FolderChoice.Recent({ place: scratch })),
    }
    const typed = {
      ...inCrook,
      folder: Option.some(FolderChoice.Typed({ folder: '/srv/hub' })),
    }

    expect(newAgentChips(view, inCrook, '')).toEqual(
      Option.some({
        machine: 'laptop',
        folder: Option.some('crook'),
        branch: Option.some({ label: 'main', isNew: false }),
      }),
    )
    expect(
      newAgentChips(
        view,
        { ...inCrook, branch: BranchChoice.Worktree({ typed: Option.some('fix x') }) },
        '',
      ),
    ).toEqual(
      Option.some({
        machine: 'laptop',
        folder: Option.some('crook'),
        branch: Option.some({ label: 'new: fix-x', isNew: true }),
      }),
    )
    expect(
      Option.map(
        newAgentChips(
          view,
          { ...inCrook, branch: BranchChoice.Worktree({ typed: Option.none() }) },
          '',
        ),
        (chips) => chips.branch,
      ),
    ).toEqual(Option.some(Option.some({ label: 'new: name the branch', isNew: true })))
    expect(Option.map(newAgentChips(view, inScratch, ''), (chips) => chips.branch)).toEqual(
      Option.some(Option.none()),
    )
    expect(Option.map(newAgentChips(view, typed, ''), (chips) => chips.branch)).toEqual(
      Option.some(Option.some({ label: 'Checkout', isNew: false })),
    )
  })
})

describe('startedAgent', () => {
  it('is the new pane once the herd shows it on that machine', () => {
    const receipt = new AgentStarted({ pane: PaneId.make('w1:p9') })
    const later = herd([machine(LAPTOP, [agent('w1:p1', 'working'), agent('w1:p9', 'unknown')])])

    expect(startedAgent(herd([laptop]), LAPTOP, receipt)).toEqual(Option.none())
    expect(startedAgent(later, LAPTOP, receipt)).toEqual(
      Option.some({ machine: LAPTOP, pane: receipt.pane }),
    )
    expect(startedAgent(later, DESK, receipt)).toEqual(Option.none())
  })
})
