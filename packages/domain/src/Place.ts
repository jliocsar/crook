import * as Schema from 'effect/Schema'

export class Place extends Schema.Class<Place>('Place')({
  folder: Schema.String,
  branch: Schema.OptionFromNullOr(Schema.String),
  usedAt: Schema.DateTimeUtcFromString,
}) {}
