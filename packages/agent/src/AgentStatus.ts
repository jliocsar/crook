import * as BunSocket from '@effect/platform-bun/BunSocket'
import * as BunSocketServer from '@effect/platform-bun/BunSocketServer'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Schema from 'effect/Schema'
import * as Socket from 'effect/socket/Socket'
import * as Stream from 'effect/Stream'

import { HubConnection, HubConnectionStatus } from '@crook/agent/HubConnection'
import { agentVersion } from '@crook/agent/HubLink'
import { makeEnsureParentDirectory, stateFile } from '@crook/agent/StateDirectory'

const SLOWEST_MEASURED_ANSWER = Duration.millis(21.269)
const STATUS_REQUEST = 'status\n'

export const STATUS_ANSWER_TIMEOUT = Duration.times(SLOWEST_MEASURED_ANSWER, 10)

export const CrookStatusSocketPath = stateFile('CROOK_STATUS_SOCKET_PATH', 'status.sock')

export class RunningAgent extends Schema.Class<RunningAgent>('RunningAgent')({
  agentVersion: Schema.String,
  processId: Schema.Int,
  startedAt: Schema.DateTimeUtcFromString,
  hub: HubConnection,
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
  const fileSystem = yield* FileSystem.FileSystem
  const ensureParentDirectory = yield* makeEnsureParentDirectory
  const path = yield* CrookStatusSocketPath
  const hub = yield* HubConnectionStatus
  const startedAt = yield* DateTime.now

  const answer = Effect.fn('AgentStatus.answer')(function* (socket: Socket.Socket) {
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

  const answerOrIgnore = Effect.fn('AgentStatus.answerOrIgnore')(function* (socket: Socket.Socket) {
    return yield* answer(socket).pipe(
      Effect.catch((error) =>
        Effect.logDebug(`Could not answer a status request: ${error.message}`),
      ),
    )
  })

  const listen = Effect.fn('AgentStatus.listen')(function* () {
    yield* ensureParentDirectory(path)
    yield* fileSystem.remove(path, { force: true })

    const server = yield* BunSocketServer.make({ path })

    yield* server.run(answerOrIgnore).pipe(Effect.forkScoped)
  })

  yield* listen().pipe(
    Effect.catch((cause) => Effect.logError(new StatusSocketUnavailable({ path, cause }).message)),
  )
})

export const layer = Layer.effectDiscard(serve)

const socketFailure = (error: Socket.SocketError) =>
  Match.value(error.reason).pipe(
    Match.tag('SocketOpenError', (open) => String(open.cause)),
    Match.orElse(() => error.message),
  )

const readAnswer = Effect.fn('AgentStatus.readAnswer')(function* (path: string) {
  const socket = yield* BunSocket.makeNet({ path })
  const pull = yield* Socket.readerBytes(socket)
  const writer = yield* socket.writer

  yield* writer.write(STATUS_REQUEST)

  return yield* Stream.fromEffectRepeat(pull).pipe(
    Stream.flattenArray,
    Stream.decodeText,
    Stream.catchReason('SocketError', 'SocketCloseError', () => Stream.empty),
    Stream.mkString,
  )
}, Effect.scoped)

export const askRunningAgent = Effect.fn('AgentStatus.askRunningAgent')(function* (path: string) {
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
