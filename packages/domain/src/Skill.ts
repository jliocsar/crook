import * as Schema from 'effect/Schema'

export const SkillScope = Schema.Literals(['project', 'personal', 'plugin', 'builtin'])
export type SkillScope = typeof SkillScope.Type

export class SkillListing extends Schema.Class<SkillListing>('SkillListing')({
  name: Schema.NonEmptyString,
  description: Schema.String,
  argumentHint: Schema.OptionFromNullOr(Schema.String),
  scope: SkillScope,
}) {}
