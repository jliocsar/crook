export interface MachineChart {
  readonly file: string
  readonly chart: () => string
}

export const MACHINE_CHARTS: readonly MachineChart[] = []
