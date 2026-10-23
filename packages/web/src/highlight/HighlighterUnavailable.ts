import * as Schema from 'effect/Schema'

export class HighlighterUnavailable extends Schema.TaggedError<HighlighterUnavailable>()(
  'HighlighterUnavailable',
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return 'The code highlighter did not load, so code shows without colours. Reload crook once the network is back.'
  }
}
