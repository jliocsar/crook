import { chartOf, walk } from '@crook/web/machine/Walk'

import { linkWalk } from './LinkWalk.ts'
import { presenceWalk } from './PresenceWalk.ts'
import { transcriptWalk } from './TranscriptWalk.ts'

export interface MachineChart {
  readonly file: string
  readonly chart: () => string
}

export const MACHINE_CHARTS: readonly MachineChart[] = [
  { file: 'link.mmd', chart: () => chartOf(walk(linkWalk)) },
  { file: 'presence.mmd', chart: () => chartOf(walk(presenceWalk)) },
  { file: 'transcript.mmd', chart: () => chartOf(walk(transcriptWalk)) },
]
