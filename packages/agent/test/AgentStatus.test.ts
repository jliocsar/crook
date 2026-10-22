import * as BunServices from '@effect/platform-bun/BunServices'
import * as BunSocketServer from '@effect/platform-bun/BunSocketServer'
import { expect, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Socket from 'effect/socket/Socket'

import {
  AgentAnswerUnreadable,
  NoAgentAnswered,
  askRunningAgent,
  layer as statusLayer,
} from '@crook/agent/AgentStatus'
import { HubConnectionStatus, HubOnline } from '@crook/agent/HubConnection'
import { agentVersion } from '@crook/agent/HubLink'

const scratchSocket = Effect.fn('scratchSocket')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped()

  return `${directory}/status.sock`
})

const servingAgent = Effect.fn('servingAgent')(function* (path: string) {
  const hub = yield* Layer.build(HubConnectionStatus.layer)

  yield* Layer.build(
    Layer.provide(statusLayer, [
      Layer.succeedContext(hub),
      ConfigProvider.layer(ConfigProvider.fromUnknown({ CROOK_STATUS_SOCKET_PATH: path })),
    ]),
  )

  return Context.get(hub, HubConnectionStatus)
})

const answerEveryoneWith = Effect.fn('answerEveryoneWith')(function* (path: string, text: string) {
  const server = yield* BunSocketServer.make({ path })
  const answer = Effect.fn('answer')(function* (socket: Socket.Socket) {
    const pull = yield* Socket.readerBytes(socket)

    yield* pull

    const writer = yield* socket.writer

    yield* writer.write(text)
  }, Effect.scoped)

  yield* server.run(answer).pipe(Effect.forkScoped)
})

layer(BunServices.layer, { excludeTestServices: true })('AgentStatus', (live) => {
  live.effect('answers with its version, its process and its link to the hub', () =>
    Effect.gen(function* () {
      const path = yield* scratchSocket()
      const hub = yield* servingAgent(path)

      yield* hub.online

      const running = yield* askRunningAgent(path)

      expect(running.agentVersion).toBe(agentVersion)
      expect(running.processId).toBe(process.pid)
      expect(running.hub).toBeInstanceOf(HubOnline)
    }),
  )

  live.effect('answers every caller, one after another', () =>
    Effect.gen(function* () {
      const path = yield* scratchSocket()

      yield* servingAgent(path)

      const answers = yield* Effect.forEach([1, 2, 3], () => askRunningAgent(path))

      expect(answers.map((running) => running.processId)).toEqual([
        process.pid,
        process.pid,
        process.pid,
      ])
    }),
  )

  live.effect('says no agent answered when nothing listens there', () =>
    Effect.gen(function* () {
      const path = yield* scratchSocket()
      const failure = yield* askRunningAgent(path).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(NoAgentAnswered)
      expect(failure.message).toContain(`No crook agent answered on ${path}`)
    }),
  )

  live.effect('tells an answer it cannot read apart from no answer', () =>
    Effect.gen(function* () {
      const path = yield* scratchSocket()

      yield* answerEveryoneWith(path, '{"agentVersion":"9.9.9"}')

      const failure = yield* askRunningAgent(path).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(AgentAnswerUnreadable)
    }),
  )
})
