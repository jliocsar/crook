import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import { caseName, caseNames } from '@crook/web/machine/Machine'
import type { Machine, Step } from '@crook/web/machine/Machine'

export interface Invariant<State> {
  readonly name: string
  readonly holds: (state: State) => boolean
}

export interface Arrow<State, Event, Command> {
  readonly from: State
  readonly event: Event
  readonly to: State
  readonly commands: readonly Command[]
}

export interface ArrowRule<State, Event, Command> {
  readonly name: string
  readonly holds: (arrow: Arrow<State, Event, Command>) => boolean
}

export interface WalkSpec<State, Event, Command> {
  readonly machine: Machine<State, Event, Command>
  readonly events: (state: State) => readonly Event[]
  readonly invariants: readonly Invariant<State>[]
  readonly arrowRules?: readonly ArrowRule<State, Event, Command>[]
  readonly home: (state: State) => boolean
  readonly terminal?: (state: State) => boolean
  readonly identity?: (state: State) => string
  readonly commandName?: (command: Command) => string
  readonly stateLimit?: number
}

export type WalkFinding = Data.TaggedEnum<{
  BrokenInvariant: {
    readonly invariant: string
    readonly state: string
    readonly path: readonly string[]
  }
  BrokenArrow: {
    readonly rule: string
    readonly from: string
    readonly event: string
    readonly to: string
  }
  NotAState: { readonly from: string; readonly event: string }
  NotTotal: { readonly from: string; readonly event: string; readonly detail: string }
  Unreachable: { readonly state: string }
  DeadEnd: { readonly state: string; readonly path: readonly string[] }
  EventNeverOffered: { readonly event: string }
  TooManyStates: { readonly limit: number }
}>

export interface WalkedState<State> {
  readonly state: State
  readonly key: string
  readonly path: readonly string[]
}

export interface WalkedArrow<State, Event, Command> extends Arrow<State, Event, Command> {
  readonly fromKey: string
  readonly toKey: string
}

export interface Walk<State, Event, Command> {
  readonly spec: WalkSpec<State, Event, Command>
  readonly states: readonly WalkedState<State>[]
  readonly arrows: readonly WalkedArrow<State, Event, Command>[]
  readonly findings: readonly WalkFinding[]
}

interface Explored<State, Event, Command> {
  readonly seen: ReadonlyMap<string, WalkedState<State>>
  readonly arrows: readonly WalkedArrow<State, Event, Command>[]
  readonly findings: readonly WalkFinding[]
}

interface ChartArrow {
  readonly from: string
  readonly to: string
  readonly label: string
}

const DEFAULT_STATE_LIMIT = 256
const ANYWHERE = 'Anywhere'

export const WalkFinding = Data.taggedEnum<WalkFinding>()

const encodedKey = <State, Event, Command>(spec: WalkSpec<State, Event, Command>) => {
  const encode = Schema.encodeUnknownSync(Schema.toCodecJson(spec.machine.states))

  return (state: State): string =>
    spec.identity === undefined ? JSON.stringify(encode(state)) : spec.identity(state)
}

const stepOf = <State, Event, Command>(
  spec: WalkSpec<State, Event, Command>,
  state: State,
  event: Event,
): Result.Result<Step<State, Command>, string> =>
  Result.try({
    try: () => spec.machine.transition(state, event),
    catch: String,
  })

const isState = <State, Event, Command>(spec: WalkSpec<State, Event, Command>) =>
  Schema.is(spec.machine.states)

const exploreOne = <State, Event, Command>(
  spec: WalkSpec<State, Event, Command>,
  keyOf: (state: State) => string,
  current: WalkedState<State>,
  explored: Explored<State, Event, Command>,
): Explored<State, Event, Command> =>
  Arr.reduce(spec.events(current.state), explored, (soFar, event) => {
    const eventName = caseName(spec.machine.events, event)
    const fromName = caseName(spec.machine.states, current.state)

    return Result.match(stepOf(spec, current.state, event), {
      onFailure: (detail) => ({
        ...soFar,
        findings: [
          ...soFar.findings,
          WalkFinding.NotTotal({ from: fromName, event: eventName, detail }),
        ],
      }),
      onSuccess: ([next, commands]) => {
        if (!isState(spec)(next)) {
          return {
            ...soFar,
            findings: [
              ...soFar.findings,
              WalkFinding.NotAState({ from: fromName, event: eventName }),
            ],
          }
        }

        const key = keyOf(next)
        const arrow = {
          from: current.state,
          event,
          to: next,
          commands,
          fromKey: current.key,
          toKey: key,
        }
        const broken = pipe(
          spec.arrowRules ?? [],
          Arr.filter((rule) => !rule.holds(arrow)),
          Arr.map((rule) =>
            WalkFinding.BrokenArrow({
              rule: rule.name,
              from: fromName,
              event: eventName,
              to: caseName(spec.machine.states, next),
            }),
          ),
        )

        return {
          seen: soFar.seen.has(key)
            ? soFar.seen
            : new Map([
                ...soFar.seen,
                [key, { state: next, key, path: [...current.path, eventName] }],
              ]),
          arrows: [...soFar.arrows, arrow],
          findings: [...soFar.findings, ...broken],
        }
      },
    })
  })

const exploreFrom = <State, Event, Command>(
  spec: WalkSpec<State, Event, Command>,
  keyOf: (state: State) => string,
  limit: number,
  frontier: readonly WalkedState<State>[],
  explored: Explored<State, Event, Command>,
): Explored<State, Event, Command> => {
  if (frontier.length === 0) {
    return explored
  }

  if (explored.seen.size > limit) {
    return {
      ...explored,
      findings: [...explored.findings, WalkFinding.TooManyStates({ limit })],
    }
  }

  const next = Arr.reduce(frontier, explored, (soFar, current) =>
    exploreOne(spec, keyOf, current, soFar),
  )
  const fresh = Arr.filter(
    Array.from(next.seen.values()),
    (walked) => !explored.seen.has(walked.key),
  )

  return exploreFrom(spec, keyOf, limit, fresh, next)
}

const reachingSettled = <State, Event, Command>(
  arrows: readonly WalkedArrow<State, Event, Command>[],
  settled: ReadonlySet<string>,
): ReadonlySet<string> => {
  const grown = new Set([
    ...settled,
    ...pipe(
      arrows,
      Arr.filter((arrow) => settled.has(arrow.toKey)),
      Arr.map((arrow) => arrow.fromKey),
    ),
  ])

  return grown.size === settled.size ? settled : reachingSettled(arrows, grown)
}

const brokenInvariants = <State, Event, Command>(
  spec: WalkSpec<State, Event, Command>,
  states: readonly WalkedState<State>[],
): readonly WalkFinding[] =>
  Arr.flatMap(states, ({ state, path }) =>
    pipe(
      spec.invariants,
      Arr.filter((invariant) => !invariant.holds(state)),
      Arr.map((invariant) =>
        WalkFinding.BrokenInvariant({
          invariant: invariant.name,
          state: caseName(spec.machine.states, state),
          path,
        }),
      ),
    ),
  )

const deadEnds = <State, Event, Command>(
  spec: WalkSpec<State, Event, Command>,
  states: readonly WalkedState<State>[],
  arrows: readonly WalkedArrow<State, Event, Command>[],
): readonly WalkFinding[] => {
  const isTerminal = spec.terminal ?? (() => false)
  const settled = pipe(
    states,
    Arr.filter(({ state }) => spec.home(state) || isTerminal(state)),
    Arr.map(({ key }) => key),
  )
  const reaching = reachingSettled(arrows, new Set(settled))

  return pipe(
    states,
    Arr.filter(({ key }) => !reaching.has(key)),
    Arr.map(({ state, path }) =>
      WalkFinding.DeadEnd({ state: caseName(spec.machine.states, state), path }),
    ),
  )
}

const unreached = <State, Event, Command>(
  spec: WalkSpec<State, Event, Command>,
  states: readonly WalkedState<State>[],
): readonly WalkFinding[] => {
  const reached = new Set(Arr.map(states, ({ state }) => caseName(spec.machine.states, state)))

  return pipe(
    caseNames(spec.machine.states),
    Arr.filter((name) => !reached.has(name)),
    Arr.map((state) => WalkFinding.Unreachable({ state })),
  )
}

const neverOffered = <State, Event, Command>(
  spec: WalkSpec<State, Event, Command>,
  states: readonly WalkedState<State>[],
): readonly WalkFinding[] => {
  const offered = new Set(
    Arr.flatMap(states, ({ state }) =>
      Arr.map(spec.events(state), (event) => caseName(spec.machine.events, event)),
    ),
  )

  return pipe(
    caseNames(spec.machine.events),
    Arr.filter((name) => !offered.has(name)),
    Arr.map((event) => WalkFinding.EventNeverOffered({ event })),
  )
}

export const walk = <State, Event, Command>(
  spec: WalkSpec<State, Event, Command>,
): Walk<State, Event, Command> => {
  const keyOf = encodedKey(spec)
  const start: WalkedState<State> = {
    state: spec.machine.initial,
    key: keyOf(spec.machine.initial),
    path: [],
  }
  const explored = exploreFrom(spec, keyOf, spec.stateLimit ?? DEFAULT_STATE_LIMIT, [start], {
    seen: new Map([[start.key, start]]),
    arrows: [],
    findings: [],
  })
  const states = Array.from(explored.seen.values())

  return {
    spec,
    states,
    arrows: explored.arrows,
    findings: [
      ...explored.findings,
      ...brokenInvariants(spec, states),
      ...deadEnds(spec, states, explored.arrows),
      ...unreached(spec, states),
      ...neverOffered(spec, states),
    ],
  }
}

const labelOf = <State, Event, Command>(
  spec: WalkSpec<State, Event, Command>,
  arrow: Arrow<State, Event, Command>,
): string => {
  const eventName = caseName(spec.machine.events, arrow.event)
  const named = spec.commandName

  return named === undefined || arrow.commands.length === 0
    ? eventName
    : `${eventName} / ${Arr.map(arrow.commands, named).join(', ')}`
}

const chartOrder = (names: readonly string[]): Order.Order<ChartArrow> => {
  const rank = (name: string): number => (name === ANYWHERE ? names.length : names.indexOf(name))

  return Order.combine(
    Order.mapInput(Order.Number, (arrow: ChartArrow) => rank(arrow.from)),
    Order.mapInput(Order.Number, (arrow: ChartArrow) => rank(arrow.to)),
  )
}

const chartArrows = <State, Event, Command>(
  charted: Walk<State, Event, Command>,
): readonly ChartArrow[] => {
  const { spec } = charted
  const nameOf = (state: State): string => caseName(spec.machine.states, state)
  const moving = Arr.filter(charted.arrows, (arrow) => nameOf(arrow.from) !== nameOf(arrow.to))
  const allNames = caseNames(spec.machine.states)
  const isTerminal = spec.terminal ?? (() => false)
  const leavable = pipe(
    charted.states,
    Arr.filter(({ state }) => !isTerminal(state)),
    Arr.map(({ state }) => nameOf(state)),
    Arr.dedupe,
  )
  const arrivals = Arr.groupBy(
    moving,
    (arrow) => `${caseName(spec.machine.events, arrow.event)} ${nameOf(arrow.to)}`,
  )
  const fromAnywhere = Object.values(arrivals).filter((group) => {
    const sources = new Set(Arr.map(group, (arrow) => nameOf(arrow.from)))

    return Arr.every(leavable, (name) => sources.has(name) || name === nameOf(group[0].to))
  })
  const anywhereArrows = Arr.map(fromAnywhere, (group) => ({
    from: ANYWHERE,
    to: nameOf(group[0].to),
    label: labelOf(spec, group[0]),
  }))
  const covered = new Set(Arr.flatMap(fromAnywhere, (group) => group))
  const direct = pipe(
    moving,
    Arr.filter((arrow) => !covered.has(arrow)),
    Arr.map((arrow) => ({
      from: nameOf(arrow.from),
      to: nameOf(arrow.to),
      label: labelOf(spec, arrow),
    })),
  )
  const merged = Arr.groupBy([...direct, ...anywhereArrows], (arrow) => `${arrow.from} ${arrow.to}`)

  return pipe(
    Object.values(merged),
    Arr.map((group) => ({
      from: group[0].from,
      to: group[0].to,
      label: pipe(
        group,
        Arr.map((arrow) => arrow.label),
        Arr.dedupe,
      ).join('<br/>'),
    })),
    Arr.sort(chartOrder(allNames)),
  )
}

export const chartOf = <State, Event, Command>(charted: Walk<State, Event, Command>): string => {
  const { spec } = charted
  const isTerminal = spec.terminal ?? (() => false)
  const arrows = chartArrows(charted)
  const startName = caseName(spec.machine.states, spec.machine.initial)
  const terminals = pipe(
    charted.states,
    Arr.filter(({ state }) => isTerminal(state)),
    Arr.map(({ state }) => caseName(spec.machine.states, state)),
    Arr.dedupe,
  )
  const usesAnywhere = Option.isSome(Arr.findFirst(arrows, (arrow) => arrow.from === ANYWHERE))

  return [
    'stateDiagram-v2',
    `  [*] --> ${startName}`,
    ...(usesAnywhere ? [`  state "from any state" as ${ANYWHERE}`] : []),
    ...Arr.map(arrows, ({ from, to, label }) => `  ${from} --> ${to}: ${label}`),
    ...Arr.map(terminals, (name) => `  ${name} --> [*]`),
    '',
  ].join('\n')
}
