import * as Arr from 'effect/Array'
import * as Schema from 'effect/Schema'

import type { Finding } from '@crook/frames/Detect'

export interface Verdict {
  readonly story: string
  readonly fresh: readonly Finding[]
  readonly known: readonly Finding[]
  readonly gone: readonly string[]
}

export const KnownFindings = Schema.Struct({
  always: Schema.Array(Schema.String),
  sometimes: Schema.optionalKey(Schema.Array(Schema.String)),
})
export type KnownFindings = typeof KnownFindings.Type

export const Baseline = Schema.Record(Schema.String, KnownFindings)
export type Baseline = typeof Baseline.Type

export const verdictOf = (
  story: string,
  findings: readonly Finding[],
  baseline: Baseline,
): Verdict => {
  const always = baseline[story]?.always ?? []
  const sometimes = baseline[story]?.sometimes ?? []
  const isKnown = (finding: Finding): boolean =>
    always.includes(finding.key) || sometimes.includes(finding.key)

  return {
    story,
    fresh: Arr.filter(findings, (finding) => !isKnown(finding)),
    known: Arr.filter(findings, isKnown),
    gone: Arr.filter(always, (key) => !findings.some((finding) => finding.key === key)),
  }
}

export const isClean = (verdict: Verdict): boolean =>
  verdict.fresh.length === 0 && verdict.gone.length === 0
