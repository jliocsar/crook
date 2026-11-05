import { chartOf, walk } from '@crook/web/machine/Walk'

import { activityWalk } from './ActivityWalk.ts'
import { composerFailureWalk } from './ComposerFailureWalk.ts'
import { indicatorWalk } from './IndicatorWalk.ts'
import { linkWalk } from './LinkWalk.ts'
import { presenceWalk } from './PresenceWalk.ts'
import { sentWaitWalk } from './SentWaitWalk.ts'
import { transcriptWalk } from './TranscriptWalk.ts'

export interface MachineChart {
  readonly file: string
  readonly chart: () => string
}

export const MACHINE_CHARTS: readonly MachineChart[] = [
  { file: 'activity.mmd', chart: () => chartOf(walk(activityWalk)) },
  { file: 'composer-failure.mmd', chart: () => chartOf(walk(composerFailureWalk)) },
  { file: 'indicator.mmd', chart: () => chartOf(walk(indicatorWalk)) },
  { file: 'link.mmd', chart: () => chartOf(walk(linkWalk)) },
  { file: 'presence.mmd', chart: () => chartOf(walk(presenceWalk)) },
  { file: 'sent-wait.mmd', chart: () => chartOf(walk(sentWaitWalk)) },
  { file: 'transcript.mmd', chart: () => chartOf(walk(transcriptWalk)) },
]
