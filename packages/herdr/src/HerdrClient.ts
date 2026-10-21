import * as BunSocket from '@effect/platform-bun/BunSocket'
import * as Arr from 'effect/Array'
import type * as NonEmptyArray from 'effect/Array'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Socket from 'effect/socket/Socket'
import * as Stream from 'effect/Stream'

import { HerdrEvent, Subscription } from '@crook/herdr/Events'
import { type HerdrMethod, SessionSnapshotMethod } from '@crook/herdr/Methods'
import type { SessionSnapshot } from '@crook/herdr/Records'

export type HerdrRequestError =
  | HerdrUnreachable
  | HerdrConnectionClosed
  | HerdrRequestInvalid
  | HerdrRequestRejected
  | HerdrPaneNotFound
  | HerdrAgentNotFound
  | HerdrPaneBusy
  | HerdrResponseInvalid

export type HerdrSubscriptionError = HerdrRequestError | HerdrEventsLost

export interface ScriptedResponse {
  readonly method: string
  readonly line: string
}

export interface SentRequest {
  readonly method: string
  readonly line: string
}

const SUBSCRIBE_METHOD = 'events.subscribe'
const EVENTS_LOST_CODE = 'events_lost'
const PANE_NOT_FOUND_CODE = 'pane_not_found'
const AGENT_NOT_FOUND_CODE = 'agent_not_found'
const PANE_BUSY_CODE = 'agent_pane_busy'

export class HerdrUnreachable extends Schema.TaggedError<HerdrUnreachable>()('HerdrUnreachable', {
  socketPath: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Could not connect to the Herdr socket at ${this.socketPath}. Check that herdr is running, or point HERDR_SOCKET_PATH at its socket.`
  }
}

export class HerdrConnectionClosed extends Schema.TaggedError<HerdrConnectionClosed>()(
  'HerdrConnectionClosed',
  { method: Schema.String },
) {
  override get message(): string {
    return `Herdr closed the connection during ${this.method} before it finished. The server most likely stopped or restarted: reconnect and re-read its state.`
  }
}

export class HerdrRequestInvalid extends Schema.TaggedError<HerdrRequestInvalid>()(
  'HerdrRequestInvalid',
  { method: Schema.String, issue: Schema.String },
) {
  override get message(): string {
    return `The params for ${this.method} could not be encoded: ${this.issue}. Fix the value passed to HerdrClient.request.`
  }
}

export class HerdrRequestRejected extends Schema.TaggedError<HerdrRequestRejected>()(
  'HerdrRequestRejected',
  { method: Schema.String, code: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Herdr rejected ${this.method} with ${this.code}: ${this.detail}.`
  }
}

export class HerdrPaneNotFound extends Schema.TaggedError<HerdrPaneNotFound>()(
  'HerdrPaneNotFound',
  { method: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Herdr reported pane_not_found for ${this.method}: ${this.detail}. The pane most likely closed in the meantime: re-read state with session.snapshot.`
  }
}

export class HerdrAgentNotFound extends Schema.TaggedError<HerdrAgentNotFound>()(
  'HerdrAgentNotFound',
  { method: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Herdr reported agent_not_found for ${this.method}: ${this.detail}. The pane no longer hosts an agent herdr recognizes, most likely because the agent exited: re-read state with session.snapshot.`
  }
}

export class HerdrPaneBusy extends Schema.TaggedError<HerdrPaneBusy>()('HerdrPaneBusy', {
  method: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Herdr reported agent_pane_busy for ${this.method}: ${this.detail}. The pane is not at an interactive shell yet, most likely because it was created a moment ago: try again shortly.`
  }
}

export class HerdrResponseInvalid extends Schema.TaggedError<HerdrResponseInvalid>()(
  'HerdrResponseInvalid',
  { method: Schema.String, issue: Schema.String },
) {
  override get message(): string {
    return `Herdr answered ${this.method} with a line crook's schema does not accept: ${this.issue}. The Herdr protocol has probably changed; compare the schemas against \`herdr api schema --json\`.`
  }
}

export class HerdrEventsLost extends Schema.TaggedError<HerdrEventsLost>()('HerdrEventsLost', {}) {
  override get message(): string {
    return 'Herdr dropped events because this subscriber fell behind, and closed the subscription. Subscribe again, then re-read state with session.snapshot.'
  }
}

export class HerdrErrorResponse extends Schema.Class<HerdrErrorResponse>('HerdrErrorResponse')({
  id: Schema.String,
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
}) {}

export class SubscriptionStarted extends Schema.Class<SubscriptionStarted>('SubscriptionStarted')({
  id: Schema.String,
  result: Schema.Struct({ type: Schema.Literal('subscription_started') }),
}) {}

const SubscriptionLine = Schema.fromJsonString(
  Schema.Union([SubscriptionStarted, HerdrErrorResponse, HerdrEvent]),
)

const SubscribeRequestLine = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.String,
    method: Schema.Literal(SUBSCRIBE_METHOD),
    params: Schema.Struct({ subscriptions: Schema.Array(Subscription) }),
  }),
)

const RequestLine = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, method: Schema.String, params: Schema.Unknown }),
)

const ResponseLine = Schema.fromJsonString(
  Schema.Union([Schema.Struct({ id: Schema.String, result: Schema.Unknown }), HerdrErrorResponse]),
)

const encodeRequest = Effect.fn('HerdrClient.encodeRequest')(function* <Params>(
  method: HerdrMethod<Params, unknown>,
  params: Params,
) {
  const toInvalid = (error: Schema.SchemaError) =>
    new HerdrRequestInvalid({ method: method.name, issue: error.message })
  const encodedParams = yield* Schema.encodeEffect(method.params)(params).pipe(
    Effect.mapError(toInvalid),
  )

  return yield* Schema.encodeEffect(RequestLine)({
    id: method.name,
    method: method.name,
    params: encodedParams,
  }).pipe(Effect.mapError(toInvalid))
})

const rejection = (method: string, response: HerdrErrorResponse) =>
  Match.value(response.error.code).pipe(
    Match.when(
      PANE_NOT_FOUND_CODE,
      () => new HerdrPaneNotFound({ method, detail: response.error.message }),
    ),
    Match.when(
      AGENT_NOT_FOUND_CODE,
      () => new HerdrAgentNotFound({ method, detail: response.error.message }),
    ),
    Match.when(PANE_BUSY_CODE, () => new HerdrPaneBusy({ method, detail: response.error.message })),
    Match.orElse(
      (code) => new HerdrRequestRejected({ method, code, detail: response.error.message }),
    ),
  )

const decodeResponse = Effect.fn('HerdrClient.decodeResponse')(function* <Result>(
  method: HerdrMethod<unknown, Result>,
  line: string,
) {
  const toInvalid = (error: Schema.SchemaError) =>
    new HerdrResponseInvalid({ method: method.name, issue: error.message })
  const response = yield* Schema.decodeEffect(ResponseLine)(line).pipe(Effect.mapError(toInvalid))

  if (Schema.is(HerdrErrorResponse)(response)) {
    return yield* rejection(method.name, response)
  }

  return yield* Schema.decodeUnknownEffect(method.result)(response.result).pipe(
    Effect.mapError(toInvalid),
  )
})

const fromSocketError = (socketPath: string, method: string) => (error: Socket.SocketError) =>
  Match.value(error.reason).pipe(
    Match.tagsExhaustive({
      SocketOpenError: (reason) => new HerdrUnreachable({ socketPath, cause: reason }),
      SocketReadError: () => new HerdrConnectionClosed({ method }),
      SocketWriteError: () => new HerdrConnectionClosed({ method }),
      SocketUpgradeError: () => new HerdrConnectionClosed({ method }),
      SocketCloseError: () => new HerdrConnectionClosed({ method }),
    }),
  )

const exchange = (socketPath: string, method: string, outgoing: Stream.Stream<string>) =>
  Stream.unwrap(
    Effect.map(BunSocket.makeNet({ path: socketPath }), (socket) =>
      outgoing.pipe(
        Stream.map((line) => `${line}\n`),
        Stream.pipeThroughChannel(Socket.toChannelString(socket)),
        Stream.splitLines,
      ),
    ),
  ).pipe(Stream.mapError(fromSocketError(socketPath, method)))

const subscriptionFailure = (response: HerdrErrorResponse): HerdrSubscriptionError =>
  response.error.code === EVENTS_LOST_CODE
    ? new HerdrEventsLost()
    : rejection(SUBSCRIBE_METHOD, response)

const makeLive = (socketPath: string) => {
  const request = Effect.fn('HerdrClient.request')(function* <Params, Result>(
    method: HerdrMethod<Params, Result>,
    params: Params,
  ) {
    const line = yield* encodeRequest(method, params)
    const reply = yield* exchange(socketPath, method.name, Stream.make(line)).pipe(Stream.runHead)
    const replyLine = yield* Option.match(reply, {
      onNone: () => Effect.fail(new HerdrConnectionClosed({ method: method.name })),
      onSome: Effect.succeed,
    })

    return yield* decodeResponse(method, replyLine)
  })

  const subscribe = Effect.fn('HerdrClient.subscribe')(function* (
    subscriptions: NonEmptyArray.NonEmptyReadonlyArray<Subscription>,
  ) {
    const line = yield* Schema.encodeEffect(SubscribeRequestLine)({
      id: SUBSCRIBE_METHOD,
      method: SUBSCRIBE_METHOD,
      params: { subscriptions },
    }).pipe(
      Effect.mapError(
        (error) => new HerdrRequestInvalid({ method: SUBSCRIBE_METHOD, issue: error.message }),
      ),
    )
    const started = yield* Deferred.make<void, HerdrSubscriptionError>()
    const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()

    const handleLine = (decoded: typeof SubscriptionLine.Type) => {
      if (Schema.is(SubscriptionStarted)(decoded)) {
        return Deferred.succeed(started, undefined)
      }

      if (Schema.is(HerdrErrorResponse)(decoded)) {
        return Effect.fail(subscriptionFailure(decoded))
      }

      return Queue.offer(events, decoded)
    }

    yield* exchange(
      socketPath,
      SUBSCRIBE_METHOD,
      Stream.concat(Stream.make(line), Stream.never),
    ).pipe(
      Stream.mapEffect((text) =>
        Schema.decodeEffect(SubscriptionLine)(text).pipe(
          Effect.mapError(
            (error) => new HerdrResponseInvalid({ method: SUBSCRIBE_METHOD, issue: error.message }),
          ),
        ),
      ),
      Stream.runForEach(handleLine),
      Effect.andThen(Effect.fail(new HerdrConnectionClosed({ method: SUBSCRIBE_METHOD }))),
      Effect.catch((error: HerdrSubscriptionError) =>
        Effect.andThen(Deferred.fail(started, error), Queue.fail(events, error)),
      ),
      Effect.forkScoped,
    )

    yield* Deferred.await(started)

    return Stream.fromQueue(events)
  })

  return HerdrClient.of({
    request,
    snapshot: Effect.map(request(SessionSnapshotMethod, {}), (result) => result.snapshot),
    subscribe,
  })
}

const makeTest = (script: {
  readonly responses: readonly ScriptedResponse[]
  readonly events: Queue.Dequeue<HerdrEvent, HerdrSubscriptionError>
  readonly sent?: Queue.Enqueue<SentRequest>
}) =>
  Effect.gen(function* () {
    const answered = yield* Ref.make(HashMap.empty<string, number>())

    const nextScripted = (method: string) =>
      Ref.modify(answered, (counts) => {
        const count = Option.getOrElse(HashMap.get(counts, method), () => 0)
        const scripted = script.responses.filter((response) => response.method === method)

        return [
          Arr.get(scripted, Math.min(count, scripted.length - 1)),
          HashMap.set(counts, method, count + 1),
        ] as const
      })

    const request = Effect.fn('HerdrClient.request')(function* <Params, Result>(
      method: HerdrMethod<Params, Result>,
      params: Params,
    ) {
      const line = yield* encodeRequest(method, params)

      if (script.sent !== undefined) {
        yield* Queue.offer(script.sent, { method: method.name, line })
      }

      const scripted = yield* nextScripted(method.name)

      if (Option.isNone(scripted)) {
        return yield* new HerdrConnectionClosed({ method: method.name })
      }

      return yield* decodeResponse(method, scripted.value.line)
    })

    return HerdrClient.of({
      request,
      snapshot: Effect.map(request(SessionSnapshotMethod, {}), (result) => result.snapshot),
      subscribe: () => Effect.succeed(Stream.fromQueue(script.events)),
    })
  })

export const scriptedResult = <Result>(
  method: HerdrMethod<unknown, Result>,
  result: Result,
): ScriptedResponse => ({
  method: method.name,
  line: Schema.encodeSync(ResponseLine)({
    id: method.name,
    result: Schema.encodeSync(method.result)(result),
  }),
})

export const scriptedRejection = (
  method: HerdrMethod<unknown, unknown>,
  code: string,
  detail: string,
): ScriptedResponse => ({
  method: method.name,
  line: Schema.encodeSync(Schema.fromJsonString(HerdrErrorResponse))(
    new HerdrErrorResponse({ id: method.name, error: { code, message: detail } }),
  ),
})

export const HerdrSocketPath = Config.String('HERDR_SOCKET_PATH').pipe(
  Config.orElse(() =>
    Config.String('HOME').pipe(Config.map((home) => `${home}/.config/herdr/herdr.sock`)),
  ),
)

export class HerdrClient extends Context.Service<
  HerdrClient,
  {
    readonly request: <Params, Result>(
      method: HerdrMethod<Params, Result>,
      params: Params,
    ) => Effect.Effect<Result, HerdrRequestError>
    readonly snapshot: Effect.Effect<SessionSnapshot, HerdrRequestError>
    readonly subscribe: (
      subscriptions: NonEmptyArray.NonEmptyReadonlyArray<Subscription>,
    ) => Effect.Effect<
      Stream.Stream<HerdrEvent, HerdrSubscriptionError>,
      HerdrSubscriptionError,
      Scope.Scope
    >
  }
>()('@crook/herdr/HerdrClient') {
  static readonly layerAt = (socketPath: string) => Layer.succeed(this, makeLive(socketPath))

  static readonly layer = Layer.effect(this, Effect.map(HerdrSocketPath, makeLive))

  static readonly layerTest = (script: Parameters<typeof makeTest>[0]) =>
    Layer.effect(this, makeTest(script))
}
