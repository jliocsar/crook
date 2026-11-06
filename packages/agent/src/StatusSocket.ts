import * as BunSocket from '@effect/platform-bun/BunSocket'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import * as Socket from 'effect/socket/Socket'

import { HubConnectionState, HubConnectionStatus } from '@crook/agent/HubConnectionStatus'
import { agentVersion } from '@crook/agent/HubLink'
import { readAllText, serveLocalSocket } from '@crook/agent/LocalSocket'
import { stateFile } from '@crook/agent/StateDirectory'

const SLOWEST_MEASURED_ANSWER_AT_REST = Duration.millis(21.269)
const SLOWEST_MEASURED_ANSWER_STARVED = Duration.millis(376.6)
const STATUS_REQUEST = 'status\n'

export const STATUS_ANSWER_TIMEOUT = Duration.times(SLOWEST_MEASURED_ANSWER_STARVED, 10)
export const SLOWEST_MEASURED_STARTUP = Duration.millis(294.3)
export const AGENT_STARTUP_TIMEOUT = Duration.times(SLOWEST_MEASURED_STARTUP, 10)

export const CrookStatusSocketPath = stateFile('CROOK_STATUS_SOCKET_PATH', 'status.sock')

export class RunningAgent extends Schema.Class<RunningAgent>('RunningAgent')({
  agentVersion: Schema.String,
  processId: Schema.Int,
  startedAt: Schema.DateTimeUtcFromString,
  hub: HubConnectionState,
}) {}

export const RunningAgentJson = Schema.fromJsonString(RunningAgent)

export class StatusSocketUnavailable extends Schema.TaggedError<StatusSocketUnavailable>()(
  'StatusSocketUnavailable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not answer status requests on ${this.path}, so "crook-agent status" and the crook plugin for Herdr cannot see this agent, though it runs. Check that folder's permissions, or point CROOK_STATUS_SOCKET_PATH elsewhere.`
  }
}

export class NoAgentAnswered extends Schema.TaggedError<NoAgentAnswered>()('NoAgentAnswered', {
  path: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `No crook agent answered on ${this.path} (${this.detail}).`
  }
}

export class AgentAnswerUnreadable extends Schema.TaggedError<AgentAnswerUnreadable>()(
  'AgentAnswerUnreadable',
  { path: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `A crook agent answered on ${this.path}, but not in a form this crook-agent reads (${this.detail}). An agent running another version does that; restart it to run this one.`
  }
}

const serve = Effect.gen(function* () {
  const path = yield* CrookStatusSocketPath
  const hub = yield* HubConnectionStatus
  const startedAt = yield* DateTime.now

  const answer = Effect.fn('StatusSocket.answer')(function* (socket: Socket.Socket) {
    const pull = yield* Socket.readerBytes(socket)

    yield* pull.pipe(Effect.timeout(STATUS_ANSWER_TIMEOUT))

    const writer = yield* socket.writer
    const connection = yield* hub.current
    const report = new RunningAgent({
      agentVersion,
      processId: process.pid,
      startedAt,
      hub: connection,
    })

    yield* writer.write(yield* Schema.encodeEffect(RunningAgentJson)(report))
  }, Effect.scoped)

  const answerOrIgnore = Effect.fn('StatusSocket.answerOrIgnore')(function* (
    socket: Socket.Socket,
  ) {
    return yield* answer(socket).pipe(
      Effect.catch((error) =>
        Effect.logDebug(`Could not answer a status request: ${error.message}`),
      ),
    )
  })

  yield* serveLocalSocket(path, answerOrIgnore, { allowHalfOpen: false }).pipe(
    Effect.catch((cause) => Effect.logError(new StatusSocketUnavailable({ path, cause }).message)),
  )
})

export const layer = Layer.effectDiscard(serve)

const socketFailure = (error: Socket.SocketError) =>
  Match.value(error.reason).pipe(
    Match.tag('SocketOpenError', (open) => String(open.cause)),
    Match.orElse(() => error.message),
  )

const readAnswer = Effect.fn('StatusSocket.readAnswer')(function* (path: string) {
  const socket = yield* BunSocket.makeNet({ path })
  const pull = yield* Socket.readerBytes(socket)
  const writer = yield* socket.writer

  yield* writer.write(STATUS_REQUEST)

  return yield* readAllText(pull)
}, Effect.scoped)

export const askRunningAgent = Effect.fn('StatusSocket.askRunningAgent')(function* (path: string) {
  const text = yield* readAnswer(path).pipe(
    Effect.timeout(STATUS_ANSWER_TIMEOUT),
    Effect.catchTags({
      TimeoutError: () =>
        Effect.fail(
          new NoAgentAnswered({
            path,
            detail: `it took longer than ${Duration.format(STATUS_ANSWER_TIMEOUT)} to answer`,
          }),
        ),
      SocketError: (error) =>
        Effect.fail(new NoAgentAnswered({ path, detail: socketFailure(error) })),
    }),
  )

  return yield* Schema.decodeEffect(RunningAgentJson)(text).pipe(
    Effect.mapError((error) => new AgentAnswerUnreadable({ path, detail: error.message })),
  )
})

const isNoAnswer = (error: NoAgentAnswered | AgentAnswerUnreadable) =>
  Match.value(error).pipe(
    Match.tag('NoAgentAnswered', () => true),
    Match.orElse(() => false),
  )

const askAgentOtherThan = Effect.fn('StatusSocket.askAgentOtherThan')(function* (
  path: string,
  previous: Option.Option<RunningAgent>,
) {
  const running = yield* askRunningAgent(path)

  if (Option.exists(previous, (before) => before.processId === running.processId)) {
    return yield* new NoAgentAnswered({
      path,
      detail: `process ${running.processId}, the agent from before, still answers`,
    })
  }

  return running
})

export const awaitAgentOtherThan = Effect.fn('StatusSocket.awaitAgentOtherThan')(function* (
  path: string,
  previous: Option.Option<RunningAgent>,
) {
  return yield* askAgentOtherThan(path, previous).pipe(
    Effect.retry({
      while: isNoAnswer,
      schedule: Schedule.spaced(SLOWEST_MEASURED_ANSWER_AT_REST).pipe(
        Schedule.upTo({ duration: AGENT_STARTUP_TIMEOUT }),
      ),
    }),
  )
})
