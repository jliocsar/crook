import * as Schema from 'effect/Schema'

import { HerdrConnectionId } from '@crook/domain/Ids'

export class HerdrLink extends Schema.Class<HerdrLink>('HerdrLink')({
  connection: HerdrConnectionId,
  lostAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
}) {}
