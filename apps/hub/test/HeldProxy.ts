import * as BunSocket from '@effect/platform-bun/BunSocket'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Schedule from 'effect/Schedule'
import * as Stream from 'effect/Stream'
import * as HttpServer from 'effect/http/HttpServer'
import * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'

import type { MachineId } from '@crook/domain/Ids'
import { AgentLink } from '@crook/protocol/AgentLink'
import { AGENT_PATH } from '@crook/protocol/HubRoutes'
import { protocolSerialization } from '@crook/protocol/Serialization'

import { agentToken, hello } from './Fixtures'

const LOOPBACK = '127.0.0.1'
const DEAD_SOCKET_PING_INTERVAL = Duration.millis(250)

export const hubPort = HttpServer.addressFormattedWith((address) =>
  Effect.succeed(Number(new URL(address).port)),
)

export const heldProxy = (port: number) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const replies = yield* Queue.unbounded<string>()
      const state = { holding: false }
      const waiting: Uint8Array[] = []
      const upstreams: Bun.Socket[] = []

      const pump = () => {
        if (state.holding) {
          return
        }

        for (const upstream of upstreams) {
          for (const bytes of waiting.splice(0)) {
            upstream.write(bytes)
          }
        }
      }

      const server = Bun.listen({
        hostname: LOOPBACK,
        port: 0,
        socket: {
          open(client) {
            void Bun.connect({
              hostname: LOOPBACK,
              port,
              socket: {
                open(upstream) {
                  upstreams.push(upstream)
                  pump()
                },
                data(_upstream, bytes) {
                  Queue.offerUnsafe(replies, bytes.toString())
                  client.write(bytes)
                },
              },
            })
          },
          data(_client, bytes) {
            waiting.push(Uint8Array.from(bytes))
            pump()
          },
          close() {
            if (state.holding) {
              return
            }

            for (const upstream of upstreams) {
              upstream.end()
            }
          },
        },
      })

      return {
        port: server.port,
        replies,
        hold: Effect.sync(() => {
          state.holding = true
        }),
        releaseFirstHeld: Effect.sync(() => {
          for (const upstream of upstreams) {
            for (const first of waiting.splice(0, 1)) {
              upstream.write(first)
            }
          }
        }),
        stop: Effect.sync(() => {
          for (const upstream of upstreams) {
            upstream.end()
          }

          server.stop(true)
        }),
      }
    }),
    (proxy) => proxy.stop,
  )

export const agentThroughProxy = (port: number, machine: MachineId) =>
  Effect.gen(function* () {
    const protocol = yield* Layer.build(
      RpcClient.layerProtocolSocket({
        pingInterval: DEAD_SOCKET_PING_INTERVAL,
        retryPolicy: Schedule.recurs(0),
      }).pipe(
        Layer.provide([
          BunSocket.layerWebSocket(`ws://${LOOPBACK}:${port}${AGENT_PATH}`, {
            headers: agentToken(machine),
          }),
          protocolSerialization,
        ]),
      ),
    )

    return yield* RpcClient.make(AgentLink).pipe(Effect.provide(protocol))
  })

export const attach = (client: RpcClient.FromGroup<typeof AgentLink, RpcClientError>) =>
  client.Attach({ hello }).pipe(Stream.runDrain, Effect.ignore({ log: 'Debug' }), Effect.forkScoped)

export const replyFrom = (replies: Queue.Queue<string>, part: string) =>
  Stream.fromQueue(replies).pipe(
    Stream.filter((text) => text.includes(part)),
    Stream.runHead,
  )
