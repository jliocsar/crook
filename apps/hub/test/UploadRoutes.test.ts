import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Stream from 'effect/Stream'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import {
  AttachmentRef,
  attachmentDigestOf,
  FIRST_AGENT_WITH_ATTACHMENTS,
  InputDelivered,
  Prompt,
} from '@crook/domain/Command'
import { IdempotencyKey, MachineId, TerminalId } from '@crook/domain/Ids'
import { AgentLink, Hello } from '@crook/protocol/AgentLink'
import { ClientApi } from '@crook/protocol/ClientApi'
import { AttachmentsUnsupported } from '@crook/protocol/Commands'
import {
  AGENT_PATH,
  CLIENT_PATH,
  UPLOAD_MACHINE_PARAMETER,
  UPLOADS_PATH,
} from '@crook/protocol/HubRoutes'

import {
  PANE,
  agentRow,
  agentToken,
  connect,
  hello,
  machineStateWith,
  ownerLogin,
  testHub,
} from './Fixtures'

const PHOTO = new TextEncoder().encode('a photo, or bytes standing in for one')
const OTHER_BYTES = new TextEncoder().encode('something else entirely')
const DELIVERED_SEQ = 7

const helloAt = (agentVersion: string) => new Hello({ agentVersion, label: Option.none() })

const attachedAgent = Effect.fn('attachedAgent')(function* (machine: MachineId, greeting: Hello) {
  const agent = yield* connect(AgentLink, AGENT_PATH, agentToken(machine))

  yield* agent.Attach({ hello: greeting }).pipe(
    Stream.runForEach((routed) =>
      agent.CompleteCommand({
        id: routed.id,
        result: Result.succeed(
          new InputDelivered({
            pane: PANE,
            terminal: TerminalId.make('term_1'),
            stateChangeSeq: DELIVERED_SEQ,
          }),
        ),
      }),
    ),
    Effect.ignore({ log: 'Debug' }),
    Effect.forkScoped,
  )
  yield* agent.PublishState({ state: machineStateWith(machine, 1, [agentRow()]) })
})

const uploadPath = (digest: string) => `${UPLOADS_PATH}/${digest}`

const answered = (request: HttpClientRequest.HttpClientRequest) =>
  HttpClient.execute(request).pipe(
    Effect.flatMap((response) =>
      Effect.map(response.arrayBuffer, (body) => ({
        status: response.status,
        body: new Uint8Array(body),
      })),
    ),
  )

const put = (machine: MachineId, digest: string, bytes: Uint8Array, headers = ownerLogin) =>
  answered(
    HttpClientRequest.put(uploadPath(digest)).pipe(
      HttpClientRequest.setUrlParam(UPLOAD_MACHINE_PARAMETER, machine),
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyUint8Array(bytes),
    ),
  )

const fetchAs = (machine: string, digest: string) =>
  answered(
    HttpClientRequest.get(uploadPath(digest)).pipe(
      HttpClientRequest.setHeaders(agentToken(machine)),
    ),
  )

const promptWith = (digest: AttachmentRef['digest']) =>
  new Prompt({
    pane: PANE,
    text: '',
    attachments: [
      new AttachmentRef({
        name: 'photo.png',
        mediaType: 'image/png',
        size: PHOTO.byteLength,
        digest,
      }),
    ],
  })

layer(testHub, { excludeTestServices: true })('UploadRoutes', (live) => {
  live.effect('holds what the phone uploads for that machine, and hands it to its agent only', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('upload-laptop')
      const digest = yield* attachmentDigestOf(PHOTO)

      yield* attachedAgent(machine, helloAt(FIRST_AGENT_WITH_ATTACHMENTS))

      const stored = yield* put(machine, digest, PHOTO)
      const fetched = yield* fetchAs(machine, digest)
      const elsewhere = yield* fetchAs('upload-desktop', digest)

      expect(stored.status).toBe(204)
      expect(fetched).toEqual({ status: 200, body: PHOTO })
      expect(elsewhere.status).toBe(404)
    }),
  )

  live.effect(
    'refuses an upload from outside the browser login, for no machine, or with other bytes',
    () =>
      Effect.gen(function* () {
        const machine = MachineId.make('upload-refusals')
        const digest = yield* attachmentDigestOf(PHOTO)

        yield* attachedAgent(machine, helloAt(FIRST_AGENT_WITH_ATTACHMENTS))

        const anonymous = yield* put(machine, digest, PHOTO, {
          ...ownerLogin,
          Origin: 'https://evil.example',
        })
        const stranger = yield* put(MachineId.make('not-in-the-herd'), digest, PHOTO)
        const misnamed = yield* put(machine, digest, OTHER_BYTES)
        const unnamed = yield* put(machine, 'not-a-digest', PHOTO)
        const nothingKept = yield* fetchAs(machine, digest)

        expect(anonymous.status).toBe(403)
        expect(stranger.status).toBe(400)
        expect(misnamed.status).toBe(422)
        expect(unnamed.status).toBe(400)
        expect(nothingKept.status).toBe(404)
      }),
  )

  live.effect('sends a prompt with attachments only to an agent that takes them', () =>
    Effect.gen(function* () {
      const current = MachineId.make('attachments-current')
      const older = MachineId.make('attachments-older')
      const digest = yield* attachmentDigestOf(PHOTO)

      yield* attachedAgent(current, helloAt(FIRST_AGENT_WITH_ATTACHMENTS))
      yield* attachedAgent(older, hello)

      const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
      const delivered = yield* phone.SendCommand({
        machine: current,
        key: IdempotencyKey.make('attach-current'),
        command: promptWith(digest),
      })
      const refused = yield* phone
        .SendCommand({
          machine: older,
          key: IdempotencyKey.make('attach-older'),
          command: promptWith(digest),
        })
        .pipe(Effect.flip)
      const plain = yield* phone.SendCommand({
        machine: older,
        key: IdempotencyKey.make('plain-older'),
        command: new Prompt({ pane: PANE, text: 'continue', attachments: [] }),
      })

      expect(delivered).toEqual(
        new InputDelivered({
          pane: PANE,
          terminal: TerminalId.make('term_1'),
          stateChangeSeq: DELIVERED_SEQ,
        }),
      )
      expect(refused).toEqual(new AttachmentsUnsupported({ machine: older }))
      expect(plain).toBeInstanceOf(InputDelivered)
    }),
  )
})
