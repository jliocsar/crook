import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

import type { Finding } from '@crook/frames/Detect'
import { marksOf } from '@crook/frames/FrameLog'
import type { RecordedFrame } from '@crook/frames/FrameLog'

export interface Tile {
  readonly frame: RecordedFrame
  readonly image: string
  readonly flagged: boolean
}

export const SHEET_COLUMNS = 8
export const TILE_WIDTH = 180
export const SHEET_WIDTH = SHEET_COLUMNS * TILE_WIDTH

const sameMarks = (one: RecordedFrame, other: RecordedFrame): boolean =>
  marksOf(one).join() === marksOf(other).join() && one.blank === other.blank

export const flaggedFrames = (findings: readonly Finding[]): ReadonlySet<number> =>
  new Set(
    Arr.flatMap(findings, (finding) => [finding.firstFrame, finding.imageFrame, finding.lastFrame]),
  )

export const tileFrames = (
  frames: readonly RecordedFrame[],
  flagged: ReadonlySet<number>,
): readonly RecordedFrame[] =>
  Arr.filter(
    frames,
    (frame, index) =>
      flagged.has(frame.frame) ||
      Option.match(Arr.get(frames, index - 1), {
        onNone: () => true,
        onSome: (previous) => !sameMarks(previous, frame),
      }),
  )

const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const tileHtml = ({ frame, image, flagged }: Tile): string =>
  [
    `<figure class="${flagged ? 'flagged' : ''}">`,
    `<img src="${image}" alt="frame ${frame.frame}">`,
    `<figcaption><b>frame ${frame.frame}</b> ${Math.round(frame.at)} ms<br>${escapeHtml(
      frame.blank ? `BLANK ${marksOf(frame).join(', ')}` : marksOf(frame).join(', '),
    )}</figcaption>`,
    '</figure>',
  ].join('')

export const sheetHtml = (story: string, tiles: readonly Tile[]): string =>
  [
    '<!doctype html><meta charset="utf-8"><style>',
    `body{margin:0;width:${SHEET_WIDTH}px;background:#222;color:#eee;font:11px/1.3 monospace}`,
    'h1{font-size:14px;margin:8px}',
    `main{display:grid;grid-template-columns:repeat(${SHEET_COLUMNS},${TILE_WIDTH}px)}`,
    'figure{margin:4px;padding:2px;border:2px solid #444}',
    'figure.flagged{border-color:#f33}',
    'img{width:100%;display:block}',
    'figcaption{padding:2px;overflow-wrap:anywhere}',
    '</style>',
    `<h1>${escapeHtml(story)}: red tiles are frames a finding names; every other tile is a frame where the marks changed</h1>`,
    `<main>${tiles.map(tileHtml).join('')}</main>`,
  ].join('')
