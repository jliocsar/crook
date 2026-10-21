import * as Schema from 'effect/Schema'

const ROOT = '/'

export const AbsolutePath = Schema.String.check(Schema.isStartingWith(ROOT))
