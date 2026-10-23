import * as Arr from 'effect/Array'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'

export const CrookVersion = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u)).pipe(
  Schema.brand('CrookVersion'),
)
export type CrookVersion = typeof CrookVersion.Type

const releaseNumbers = (version: CrookVersion) => version.split('.').map(Number)

const CrookVersionOrder: Order.Order<CrookVersion> = Order.mapInput(
  Arr.makeOrder(Order.Number),
  releaseNumbers,
)

export const isBehind = (version: CrookVersion, reference: CrookVersion): boolean =>
  Order.isLessThan(CrookVersionOrder)(version, reference)
