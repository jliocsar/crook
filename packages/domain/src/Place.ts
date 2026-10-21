import * as DateTime from 'effect/DateTime'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'

export class Checkout extends Schema.Class<Checkout>('Checkout')({
  branch: Schema.OptionFromNullOr(Schema.String),
}) {}

export class Place extends Schema.Class<Place>('Place')({
  folder: Schema.String,
  checkout: Schema.OptionFromNullOr(Checkout),
  usedAt: Schema.DateTimeUtcFromString,
}) {}

export const byMostRecentUse: Order.Order<{ readonly usedAt: DateTime.Utc }> = Order.mapInput(
  Order.flip(DateTime.Order),
  (used) => used.usedAt,
)
