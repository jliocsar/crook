import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/process/ChildProcess'
import { ChildProcessSpawner } from 'effect/process/ChildProcessSpawner'
import * as Socket from 'effect/socket/Socket'

export interface ScreencastFrame {
  readonly data: string
  readonly timestampSeconds: number
}

export interface Page {
  readonly send: (method: string, params?: Schema.Json) => Effect.Effect<Schema.Json, BrowserFailed>
  readonly evaluate: (expression: string) => Effect.Effect<Schema.Json, BrowserFailed>
  readonly screencastFrames: Queue.Queue<ScreencastFrame>
}

const SESSION = 'crook-frames'
const VIEWPORT_WIDTH = '390'
const VIEWPORT_HEIGHT = '844'
const CPU_THROTTLE_RATE = 4
const SUCCESS = 0
const SCREENCAST_FRAME = 'Page.screencastFrame'

export class BrowserFailed extends Schema.TaggedError<BrowserFailed>()('BrowserFailed', {
  step: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `The browser step "${this.step}" failed: ${this.detail} Check that agent-browser runs on this machine (agent-browser doctor), and that no other session called ${SESSION} is open.`
  }
}

const CdpMessage = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Int),
    error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
    result: Schema.optionalKey(Schema.Json),
    method: Schema.optionalKey(Schema.String),
    params: Schema.optionalKey(Schema.Json),
  }),
)

const ScreencastParams = Schema.Struct({
  data: Schema.String,
  sessionId: Schema.Int,
  metadata: Schema.Struct({ timestamp: Schema.Finite }),
})

const TargetList = Schema.Struct({
  targetInfos: Schema.Array(Schema.Struct({ targetId: Schema.String, type: Schema.String })),
})

const AttachedTarget = Schema.Struct({ sessionId: Schema.String })

const Evaluated = Schema.Struct({
  result: Schema.Struct({ value: Schema.optionalKey(Schema.Json) }),
  exceptionDetails: Schema.optionalKey(Schema.Struct({ text: Schema.String })),
})

const encodeRequest = Schema.encodeSync(Schema.fromJsonString(Schema.Json))
const decodeMessage = Schema.decodeUnknownOption(CdpMessage)
const decodeScreencast = Schema.decodeUnknownOption(ScreencastParams)

const runAgentBrowser = Effect.fn('Browser.runAgentBrowser')(function* (args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner
  const handle = yield* spawner.spawn(
    ChildProcess.make('agent-browser', ['--session', SESSION, ...args]),
  )
  const [detail, output, exitCode] = yield* Effect.all(
    [
      Stream.mkString(Stream.decodeText(handle.stderr)),
      Stream.mkString(Stream.decodeText(handle.stdout)),
      handle.exitCode,
    ],
    { concurrency: 'unbounded' },
  )

  return yield* exitCode === SUCCESS
    ? Effect.succeed(output.trim())
    : Effect.fail(
        new BrowserFailed({ step: `agent-browser ${args.join(' ')}`, detail: detail.trim() }),
      )
}, Effect.scoped)

const refused = (step: string) => (cause: { readonly message: string }) =>
  new BrowserFailed({ step, detail: cause.message })

const connect = Effect.fn('Browser.connect')(function* (url: string) {
  const socket = yield* Socket.makeWebSocket(url)
  const writer = yield* socket.writer
  const pull = yield* Socket.readerString(socket).pipe(
    Effect.mapError(refused('reads the browser')),
  )
  const nextId = yield* Ref.make(1)
  const pending = MutableHashMap.empty<number, Deferred.Deferred<Schema.Json, BrowserFailed>>()
  const screencastFrames = yield* Queue.unbounded<ScreencastFrame>()
  const closed = yield* Deferred.make<never, BrowserFailed>()

  const call = Effect.fn('Browser.call')(function* (
    method: string,
    params: Schema.Json,
    sessionId: Option.Option<string>,
  ) {
    const id = yield* Ref.getAndUpdate(nextId, (current) => current + 1)
    const answer = yield* Deferred.make<Schema.Json, BrowserFailed>()

    MutableHashMap.set(pending, id, answer)
    yield* writer
      .write(
        encodeRequest({
          id,
          method,
          params,
          ...Option.match(sessionId, {
            onNone: () => ({}),
            onSome: (session) => ({ sessionId: session }),
          }),
        }),
      )
      .pipe(Effect.mapError(refused(method)))

    return yield* Effect.raceFirst(Deferred.await(answer), Deferred.await(closed))
  })

  const answerCall = (id: number, error: Option.Option<string>, result: Schema.Json) =>
    Effect.gen(function* () {
      const answer = MutableHashMap.get(pending, id)

      MutableHashMap.remove(pending, id)

      if (Option.isSome(answer)) {
        yield* Option.match(error, {
          onNone: () => Deferred.succeed(answer.value, result),
          onSome: (detail) =>
            Deferred.fail(answer.value, new BrowserFailed({ step: 'a browser call', detail })),
        })
      }
    })

  const onScreencastFrame = (
    params: Schema.Json,
    sessionId: Option.Option<string>,
  ): Effect.Effect<void, BrowserFailed> =>
    Option.match(decodeScreencast(params), {
      onNone: () => Effect.void,
      onSome: (frame) =>
        Queue.offer(screencastFrames, {
          data: frame.data,
          timestampSeconds: frame.metadata.timestamp,
        }).pipe(
          Effect.andThen(
            call('Page.screencastFrameAck', { sessionId: frame.sessionId }, sessionId),
          ),
        ),
    })

  const pageSession = yield* Ref.make(Option.none<string>())

  const routeEvent = (method: string | undefined, params: Schema.Json) =>
    method === SCREENCAST_FRAME
      ? Effect.forkScoped(
          Effect.flatMap(Ref.get(pageSession), (session) => onScreencastFrame(params, session)),
        )
      : Effect.void

  const route = (text: string) =>
    Option.match(decodeMessage(text), {
      onNone: () => Effect.void,
      onSome: ({ id, error, result, method, params }) =>
        id === undefined
          ? routeEvent(method, params ?? null)
          : answerCall(
              id,
              Option.map(Option.fromUndefinedOr(error), ({ message }) => message),
              result ?? null,
            ),
    })

  yield* pull.pipe(
    Effect.flatMap((messages) => Effect.forEach(messages, route, { discard: true })),
    Effect.forever,
    Effect.catch((cause) =>
      Deferred.fail(
        closed,
        new BrowserFailed({ step: 'the browser connection', detail: cause.message }),
      ),
    ),
    Effect.forkScoped,
  )

  const browserCall = (method: string, params: Schema.Json = {}) =>
    call(method, params, Option.none())
  const targets = yield* Effect.flatMap(browserCall('Target.getTargets'), (answer) =>
    Schema.decodeUnknownEffect(TargetList)(answer).pipe(Effect.mapError(refused('lists the tabs'))),
  )
  const tab = targets.targetInfos.find((target) => target.type === 'page')

  if (tab === undefined) {
    return yield* new BrowserFailed({
      step: 'finds the tab',
      detail: 'The browser has no page open.',
    })
  }

  const { sessionId } = yield* Effect.flatMap(
    browserCall('Target.attachToTarget', { targetId: tab.targetId, flatten: true }),
    (answer) =>
      Schema.decodeUnknownEffect(AttachedTarget)(answer).pipe(
        Effect.mapError(refused('attaches to the tab')),
      ),
  )

  yield* Ref.set(pageSession, Option.some(sessionId))

  const send = (method: string, params: Schema.Json = {}) =>
    call(method, params, Option.some(sessionId))

  const evaluate = Effect.fn('Browser.evaluate')(function* (expression: string) {
    const answer = yield* send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    const { result, exceptionDetails } = yield* Schema.decodeUnknownEffect(Evaluated)(answer).pipe(
      Effect.mapError(refused(`evaluates ${expression}`)),
    )

    return yield* exceptionDetails === undefined
      ? Effect.succeed(result.value ?? null)
      : Effect.fail(
          new BrowserFailed({ step: `evaluates ${expression}`, detail: exceptionDetails.text }),
        )
  })

  yield* send('Page.enable')
  yield* send('Runtime.enable')

  return { send, evaluate, screencastFrames } satisfies Page
})

const closeSession = runAgentBrowser(['close']).pipe(
  Effect.catch((cause) => Effect.logWarning(`Closing the browser failed: ${cause.message}`)),
)

export const setCpuThrottle = (page: Page, on: boolean) =>
  page.send('Emulation.setCPUThrottlingRate', { rate: on ? CPU_THROTTLE_RATE : 1 })

export const openBrowser = Effect.fn('Browser.openBrowser')(function* (recorderFile: string) {
  yield* Effect.acquireRelease(
    runAgentBrowser(['--init-script', recorderFile, 'open', 'about:blank']).pipe(
      Effect.catchTag('PlatformError', refused('starts agent-browser')),
    ),
    () => closeSession,
  )
  yield* runAgentBrowser(['set', 'viewport', VIEWPORT_WIDTH, VIEWPORT_HEIGHT]).pipe(
    Effect.catchTag('PlatformError', refused('sets the viewport')),
  )

  const url = yield* runAgentBrowser(['get', 'cdp-url']).pipe(
    Effect.catchTag('PlatformError', refused('asks for the CDP address')),
  )

  return yield* connect(url)
})

export const SCREENCAST_OPTIONS = { format: 'jpeg', quality: 60, everyNthFrame: 1 }
export const RETRY_POLL = Schedule.spaced(Duration.millis(100))
