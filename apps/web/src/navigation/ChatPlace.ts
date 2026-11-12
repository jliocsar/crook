import type { RegisteredRouter } from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

import type { MachineId, PaneId } from '@crook/domain/Ids'

export type ChatParent = 'agents' | 'machine'

export const CHAT_ROUTES = {
  agents: {
    chat: '/m/$machine/p/$pane',
    subagent: '/m/$machine/p/$pane/sub/$session/$subagent',
  },
  machine: {
    chat: '/machines/$machine/p/$pane',
    subagent: '/machines/$machine/p/$pane/sub/$session/$subagent',
  },
} as const satisfies Record<ChatParent, { readonly chat: string; readonly subagent: string }>

const CHAT_PARENTS: readonly ChatParent[] = ['agents', 'machine']
const AGENTS_PATHNAME = '/'

const parentPathnameOf = (
  router: RegisteredRouter,
  parent: ChatParent,
  machine: MachineId,
): string =>
  ({
    agents: () => AGENTS_PATHNAME,
    machine: () => router.buildLocation({ to: '/machines/$machine', params: { machine } }).pathname,
  })[parent]()

export const parentOfShownChat = (
  router: RegisteredRouter,
  machine: MachineId,
  pane: PaneId,
): Option.Option<string> =>
  pipe(
    CHAT_PARENTS,
    Arr.findFirst(
      (parent) =>
        router.state.location.pathname ===
        router.buildLocation({ to: CHAT_ROUTES[parent].chat, params: { machine, pane } }).pathname,
    ),
    Option.map((parent) => parentPathnameOf(router, parent, machine)),
  )
