import { describe, expect, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import type * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { PaneId } from '@crook/domain/Ids'
import type { OpenedTimes } from '@crook/domain/OpenedTimes'
import { OpenedAgents, OpenedTimesUnavailable } from '@crook/web/cache/OpenedAgents'
import type { OpenedStore } from '@crook/web/cache/OpenedAgents'

import { LAPTOP } from '../HerdFixtures.ts'

const FIRST = PaneId.make('w1:p1')
const GONE = PaneId.make('w1:p9')
const EPOCH = DateTime.makeUnsafe(0)

const agentsOver = Effect.fn('agentsOver')(function* (store: OpenedStore) {
  const context = yield* Layer.build(OpenedAgents.layerOver(store))

  return Context.get(context, OpenedAgents)
})

const memoryStore = Effect.fn('memoryStore')(function* (initial: Schema.Json | undefined) {
  const stored = yield* Ref.make<unknown>(initial)
  const store: OpenedStore = {
    read: Ref.get(stored),
    write: (value) => Ref.set(stored, structuredClone(value)),
  }

  return { store, stored }
})

const currentTimes = (agents: { readonly times: Stream.Stream<OpenedTimes> }) =>
  Stream.runHead(agents.times)

describe('OpenedAgents', () => {
  it.effect('stamps an opened chat, saves it, and loads it back after a restart', () =>
    Effect.gen(function* () {
      const { store, stored } = yield* memoryStore(undefined)
      const agents = yield* agentsOver(store)

      expect(yield* currentTimes(agents)).toEqual(Option.some({}))

      yield* agents.record({ machine: LAPTOP, pane: FIRST, listed: Option.some([FIRST]) })

      const restarted = yield* agentsOver(store)

      expect(yield* currentTimes(agents)).toEqual(Option.some({ [LAPTOP]: { [FIRST]: EPOCH } }))
      expect(yield* Ref.get(stored)).toEqual({ laptop: { 'w1:p1': '1970-01-01T00:00:00.000Z' } })
      expect(yield* currentTimes(restarted)).toEqual(Option.some({ [LAPTOP]: { [FIRST]: EPOCH } }))
    }),
  )

  it.effect('drops the panes its machine no longer lists when it saves', () =>
    Effect.gen(function* () {
      const { store, stored } = yield* memoryStore({
        laptop: { 'w1:p9': '1970-01-01T00:00:00.000Z' },
      })
      const agents = yield* agentsOver(store)

      expect(yield* currentTimes(agents)).toEqual(Option.some({ [LAPTOP]: { [GONE]: EPOCH } }))

      yield* agents.record({ machine: LAPTOP, pane: FIRST, listed: Option.some([FIRST]) })

      expect(yield* Ref.get(stored)).toEqual({ laptop: { 'w1:p1': '1970-01-01T00:00:00.000Z' } })
    }),
  )

  it.effect('starts over when what it stored no longer decodes', () =>
    Effect.gen(function* () {
      const { store } = yield* memoryStore({ laptop: 'not a map of panes' })
      const agents = yield* agentsOver(store)

      expect(yield* currentTimes(agents)).toEqual(Option.some({}))
    }),
  )

  it.effect('still orders by the chats opened this session when the browser refuses storage', () =>
    Effect.gen(function* () {
      const refused = new OpenedTimesUnavailable({ cause: 'quota exceeded' })
      const agents = yield* agentsOver({
        read: Effect.fail(refused),
        write: () => Effect.fail(refused),
      })

      yield* agents.record({ machine: LAPTOP, pane: FIRST, listed: Option.none() })

      expect(yield* currentTimes(agents)).toEqual(Option.some({ [LAPTOP]: { [FIRST]: EPOCH } }))
    }),
  )
})
