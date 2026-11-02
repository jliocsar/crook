import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

export const flatMapSome =
  <Value, Next, Failure, Requirements>(
    next: (value: Value) => Effect.Effect<Option.Option<Next>, Failure, Requirements>,
  ) =>
  <SelfFailure, SelfRequirements>(
    self: Effect.Effect<Option.Option<Value>, SelfFailure, SelfRequirements>,
  ): Effect.Effect<Option.Option<Next>, SelfFailure | Failure, SelfRequirements | Requirements> =>
    Effect.flatMap(
      self,
      Option.match({ onNone: () => Effect.succeed(Option.none<Next>()), onSome: next }),
    )

export const orElseSome =
  <Value, Failure, Requirements>(
    fallback: () => Effect.Effect<Option.Option<Value>, Failure, Requirements>,
  ) =>
  <SelfFailure, SelfRequirements>(
    self: Effect.Effect<Option.Option<Value>, SelfFailure, SelfRequirements>,
  ): Effect.Effect<Option.Option<Value>, SelfFailure | Failure, SelfRequirements | Requirements> =>
    Effect.flatMap(self, Option.match({ onNone: fallback, onSome: Effect.succeedSome }))
