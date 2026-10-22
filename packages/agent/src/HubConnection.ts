import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'

export class HubOnline extends Schema.TaggedClass<HubOnline>()('HubOnline', {
  since: Schema.DateTimeUtcFromString,
}) {}

export class HubOffline extends Schema.TaggedClass<HubOffline>()('HubOffline', {
  since: Schema.DateTimeUtcFromString,
  lastFailure: Schema.OptionFromNullOr(Schema.String),
}) {}

export const HubConnection = Schema.Union([HubOnline, HubOffline])

export type HubConnection = typeof HubConnection.Type

const wentOnline = (now: DateTime.Utc) => (current: HubConnection) =>
  Match.value(current).pipe(
    Match.tagsExhaustive({
      HubOnline: (online): HubConnection => online,
      HubOffline: () => new HubOnline({ since: now }),
    }),
  )

const wentOffline = (now: DateTime.Utc, failure: string) => (current: HubConnection) =>
  Match.value(current).pipe(
    Match.tagsExhaustive({
      HubOnline: (): HubConnection =>
        new HubOffline({ since: now, lastFailure: Option.some(failure) }),
      HubOffline: (offline) =>
        new HubOffline({ since: offline.since, lastFailure: Option.some(failure) }),
    }),
  )

const make = Effect.gen(function* () {
  const startedAt = yield* DateTime.now
  const connection = yield* Ref.make<HubConnection>(
    new HubOffline({ since: startedAt, lastFailure: Option.none() }),
  )

  return HubConnectionStatus.of({
    online: Effect.flatMap(DateTime.now, (now) => Ref.update(connection, wentOnline(now))),
    offline: (failure) =>
      Effect.flatMap(DateTime.now, (now) => Ref.update(connection, wentOffline(now, failure))),
    current: Ref.get(connection),
  })
})

export class HubConnectionStatus extends Context.Service<
  HubConnectionStatus,
  {
    readonly online: Effect.Effect<void>
    readonly offline: (failure: string) => Effect.Effect<void>
    readonly current: Effect.Effect<HubConnection>
  }
>()('@crook/agent/HubConnectionStatus') {
  static readonly layer = Layer.effect(this, make)
}
