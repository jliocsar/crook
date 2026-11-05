import { chartOf, walk } from '@crook/web/machine/Walk'

import { linkWalk } from './LinkWalk.ts'

export interface MachineChart {
  readonly file: string
  readonly chart: () => string
}

export const MACHINE_CHARTS: readonly MachineChart[] = [
  { file: 'link.mmd', chart: () => chartOf(walk(linkWalk)) },
]
