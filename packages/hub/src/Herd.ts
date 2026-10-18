import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { HerdMachine, HerdView } from '@crook/domain/HerdView'
import type { MachineId } from '@crook/domain/Ids'
import { Machine } from '@crook/domain/Machine'
import type { MachineState } from '@crook/domain/MachineState'
import { MachineIdMismatch } from '@crook/protocol/AgentLink'

interface MachineEntry {
  readonly id: MachineId
  readonly attachments: number
  readonly lastSeenAt: DateTime.Utc
  readonly state: Option.Option<MachineState>
}

const byMachineId = Order.mapInput(Order.String, (entry: MachineEntry) => entry.id)

const withAttachments = (delta: number) => (entry: MachineEntry) => ({
  ...entry,
  attachments: entry.attachments + delta,
})

const toHerdMachine = (entry: MachineEntry) =>
  new HerdMachine({
    machine: new Machine({
      id: entry.id,
      label: entry.id,
      connection: entry.attachments > 0 ? 'online' : 'offline',
      lastSeenAt: entry.lastSeenAt,
    }),
    state: entry.state,
  })

const toView = (entries: HashMap.HashMap<MachineId, MachineEntry>) =>
  new HerdView({
    machines: pipe(HashMap.toValues(entries), Arr.sort(byMachineId), Arr.map(toHerdMachine)),
  })

const make = Effect.gen(function* () {
  const entries = yield* SubscriptionRef.make(HashMap.empty<MachineId, MachineEntry>())

  const seen = (id: MachineId, update: (entry: MachineEntry) => MachineEntry) =>
    SubscriptionRef.updateEffect(entries, (current) =>
      Effect.map(DateTime.now, (now) =>
        HashMap.modifyAt(current, id, (entry) =>
          Option.some({
            ...update(
              Option.getOrElse(entry, () => ({
                id,
                attachments: 0,
                lastSeenAt: now,
                state: Option.none(),
              })),
            ),
            lastSeenAt: now,
          }),
        ),
      ),
    )

  const hold = Effect.fn('Herd.hold')(function* (id: MachineId) {
    return yield* Effect.acquireUseRelease(
      seen(id, withAttachments(1)),
      () => Effect.never,
      () => seen(id, withAttachments(-1)),
    )
  })

  const publish = Effect.fn('Herd.publish')(function* (id: MachineId, state: MachineState) {
    if (state.machine !== id) {
      return yield* new MachineIdMismatch({ connectedMachine: id, publishedMachine: state.machine })
    }

    return yield* seen(id, (entry) => ({ ...entry, state: Option.some(state) }))
  })

  return Herd.of({
    hold,
    publish,
    view: SubscriptionRef.changes(entries).pipe(
      Stream.buffer({ capacity: 1, strategy: 'sliding' }),
      Stream.map(toView),
    ),
  })
})

export class Herd extends Context.Service<
  Herd,
  {
    readonly hold: (id: MachineId) => Effect.Effect<never>
    readonly publish: (id: MachineId, state: MachineState) => Effect.Effect<void, MachineIdMismatch>
    readonly view: Stream.Stream<HerdView>
  }
>()('@crook/hub/Herd') {
  static readonly layer = Layer.effect(this, make)
}
