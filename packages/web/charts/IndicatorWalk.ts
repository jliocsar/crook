import {
  delayEnded,
  fadeEnded,
  holdEnded,
  INDICATOR_BEGAN,
  INDICATOR_ENDED,
  IndicatorCommand,
  IndicatorEvent,
  indicatorMachine,
  IndicatorState,
  isIndicatorShown,
} from '@crook/web/machine/IndicatorMachine'
import { caseName } from '@crook/web/machine/Machine'
import type { WalkSpec } from '@crook/web/machine/Walk'

const STALE_ATTEMPT = -1

const finishedEvents = (attempt: number): readonly IndicatorEvent[] => [
  delayEnded(attempt),
  holdEnded(attempt),
  fadeEnded(attempt),
]

export const indicatorWalk: WalkSpec<IndicatorState, IndicatorEvent, IndicatorCommand> = {
  machine: indicatorMachine,
  events: (state) => [
    INDICATOR_BEGAN,
    INDICATOR_ENDED,
    ...finishedEvents(state.attempt),
    ...finishedEvents(STALE_ATTEMPT),
  ],
  home: IndicatorState.guards.Hidden,
  identity: (state) => caseName(IndicatorState, state),
  commandName: IndicatorCommand.$match({
    WaitOutDelay: () => 'WaitOutDelay',
    WaitOutHold: () => 'WaitOutHold',
    WaitOutFade: () => 'WaitOutFade',
  }),
  invariants: [],
  arrowRules: [
    {
      name: 'a finished wait of an earlier attempt changes nothing',
      holds: ({ from, event, to }) =>
        !IndicatorEvent.isAnyOf(['DelayEnded', 'HoldEnded', 'FadeEnded'])(event) ||
        event.attempt !== STALE_ATTEMPT ||
        from === to,
    },
    {
      name: 'it shows only once its delay ended',
      holds: ({ from, event, to }) =>
        !isIndicatorShown(to) || isIndicatorShown(from) || IndicatorEvent.guards.DelayEnded(event),
    },
    {
      name: 'once shown it leaves only through its fade',
      holds: ({ from, to }) =>
        !isIndicatorShown(from) ||
        !IndicatorState.guards.Hidden(to) ||
        IndicatorState.guards.Leaving(from),
    },
    {
      name: 'a wait that ends before its hold is out stays shown until it is',
      holds: ({ from, event, to }) =>
        !IndicatorState.guards.Holding(from) ||
        !IndicatorEvent.guards.Ended(event) ||
        IndicatorState.guards.Lingering(to),
    },
    {
      name: 'a step starts one command at most',
      holds: ({ commands }) => commands.length <= 1,
    },
  ],
}
