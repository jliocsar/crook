import * as Schema from 'effect/Schema'

export const HerdrConnectionId = Schema.Int.pipe(Schema.brand('HerdrConnectionId'))
export type HerdrConnectionId = typeof HerdrConnectionId.Type

export class HerdrLink extends Schema.Class<HerdrLink>('HerdrLink')({
  connection: HerdrConnectionId,
  lostAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
}) {}
