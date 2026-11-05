import * as Arr from 'effect/Array'

import { isClean } from '@crook/frames/Baseline'
import type { Verdict } from '@crook/frames/Baseline'
import type { Finding } from '@crook/frames/Detect'

export type ImageOf = (frame: number) => string

const describeFinding = (finding: Finding, label: string, imageOf: ImageOf): readonly string[] => [
  `  ${label} ${finding.key}`,
  `    ${finding.words}`,
  finding.firstFrame === finding.lastFrame
    ? `    Frame ${finding.firstFrame}, ${finding.fromMs} ms after the page started.`
    : `    Frames ${finding.firstFrame} to ${finding.lastFrame}, ${finding.fromMs} ms to ${finding.toMs} ms after the page started.`,
  `    On screen then: ${finding.marks.length === 0 ? 'nothing marked' : finding.marks.join(', ')}`,
  `    Frame image (frame ${finding.imageFrame}): ${imageOf(finding.imageFrame)}`,
]

export const verdictLines = (
  verdict: Verdict,
  imageOf: ImageOf,
  sheetPath: string,
): readonly string[] => [
  `${isClean(verdict) ? 'PASS' : 'FAIL'} ${verdict.story}${verdict.known.length > 0 ? ` (${verdict.known.length} known)` : ''}`,
  ...Arr.flatMap(verdict.fresh, (finding) => describeFinding(finding, 'NEW', imageOf)),
  ...Arr.flatMap(verdict.known, (finding) => describeFinding(finding, 'known', imageOf)),
  ...Arr.map(
    verdict.gone,
    (key) =>
      `  FIXED ${key} no longer happens here. Remove it from this story in packages/frames/baseline.json.`,
  ),
  `  Contact sheet: ${sheetPath}`,
]
