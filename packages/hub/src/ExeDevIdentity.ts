import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Headers from 'effect/http/Headers'
import * as HttpServerRespondable from 'effect/http/HttpServerRespondable'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

import { MachineId } from '@crook/domain/Ids'

const EMAIL_HEADER = 'x-exedev-email'
const TOKEN_CONTEXT_HEADER = 'x-exedev-token-ctx'
const ORIGIN_HEADER = 'origin'
const SECURE_PROTOCOL = 'https:'
const FORBIDDEN = 403

export const CrookOwnerEmail = Config.String('CROOK_OWNER_EMAIL')
export const CrookHubOrigin = Config.URL('CROOK_HUB_ORIGIN')

const TokenContext = Schema.fromJsonString(Schema.Struct({ machine: MachineId }))

const forbidden = (message: string) =>
  Effect.succeed(HttpServerResponse.text(message, { status: FORBIDDEN }))

export class OwnerEmailRejected extends Schema.TaggedError<OwnerEmailRejected>()(
  'OwnerEmailRejected',
  { email: Schema.Option(Schema.String) },
) {
  override get message(): string {
    return Option.match(this.email, {
      onNone: () =>
        'This request reached the hub without an X-ExeDev-Email header, so it did not come through the exe.dev proxy with a login. Open crook through its exe.xyz address while logged in to exe.dev.',
      onSome: (email) =>
        `This request is logged in to exe.dev as "${email}", but crook only serves the owner set in CROOK_OWNER_EMAIL. Log in to exe.dev as the owner, or fix CROOK_OWNER_EMAIL on the hub.`,
    })
  }

  [HttpServerRespondable.symbol]() {
    return forbidden(this.message)
  }
}

export class BrowserLoginRequired extends Schema.TaggedError<BrowserLoginRequired>()(
  'BrowserLoginRequired',
  {},
) {
  override get message(): string {
    return 'This request authenticated with an exe.dev VM token, but the phone routes only serve the owner logged in through a browser, so a leaked agent token cannot watch or drive the herd. Agents connect to /rpc/agent; open crook in a browser logged in to exe.dev.'
  }

  [HttpServerRespondable.symbol]() {
    return forbidden(this.message)
  }
}

export class UpgradeOriginRejected extends Schema.TaggedError<UpgradeOriginRejected>()(
  'UpgradeOriginRejected',
  { origin: Schema.Option(Schema.String) },
) {
  override get message(): string {
    const from = Option.match(this.origin, {
      onNone: () => 'a client that sent no Origin header',
      onSome: (origin) => `"${origin}"`,
    })

    return `This WebSocket upgrade came from ${from}, not from crook's own origin, and the hub refuses cross-origin sockets. Open crook from the address in CROOK_HUB_ORIGIN, or fix CROOK_HUB_ORIGIN if the hub moved.`
  }

  [HttpServerRespondable.symbol]() {
    return forbidden(this.message)
  }
}

export class MachineUnidentified extends Schema.TaggedError<MachineUnidentified>()(
  'MachineUnidentified',
  {},
) {
  override get message(): string {
    return 'This agent connection carries no machine id in its exe.dev token context. Mint the agent\'s VM token for the hub with ctx {"machine":"<id>"} and set it as CROOK_HUB_TOKEN on that machine.'
  }

  [HttpServerRespondable.symbol]() {
    return forbidden(this.message)
  }
}

export class HubOriginInvalid extends Schema.TaggedError<HubOriginInvalid>()('HubOriginInvalid', {
  configured: Schema.String,
}) {
  override get message(): string {
    return `CROOK_HUB_ORIGIN is "${this.configured}", which is not an https address, so the hub cannot check where its sockets come from. Set it to the https address the phone opens crook at.`
  }
}

const requireBrowserLogin = (headers: Headers.Headers) =>
  Option.isNone(Headers.get(headers, TOKEN_CONTEXT_HEADER))
    ? Effect.void
    : Effect.fail(new BrowserLoginRequired())

const machineOf = (headers: Headers.Headers) =>
  pipe(
    Headers.get(headers, TOKEN_CONTEXT_HEADER),
    Option.flatMap(Schema.decodeUnknownOption(TokenContext)),
    Option.map((context) => context.machine),
    Effect.fromOption(() => new MachineUnidentified()),
  )

const make = Effect.gen(function* () {
  const ownerEmail = yield* CrookOwnerEmail
  const hubOrigin = yield* CrookHubOrigin.pipe(
    Effect.filterOrFail(
      (url) => url.protocol === SECURE_PROTOCOL,
      (url) => new HubOriginInvalid({ configured: url.href }),
    ),
  )

  const requireOwner = (headers: Headers.Headers): Effect.Effect<string, OwnerEmailRejected> => {
    const email = Headers.get(headers, EMAIL_HEADER)

    return Option.contains(email, ownerEmail)
      ? Effect.succeed(ownerEmail)
      : Effect.fail(new OwnerEmailRejected({ email }))
  }

  const requireSameOrigin = (headers: Headers.Headers) => {
    const origin = Headers.get(headers, ORIGIN_HEADER)

    return Option.contains(origin, hubOrigin.origin)
      ? Effect.void
      : Effect.fail(new UpgradeOriginRejected({ origin }))
  }

  const admitPhonePage = (headers: Headers.Headers) =>
    Effect.andThen(requireOwner(headers), requireBrowserLogin(headers))

  return ExeDevIdentity.of({
    admitAgent: (headers) => Effect.andThen(requireOwner(headers), machineOf(headers)),
    admitPhonePage,
    admitPhoneSocket: (headers) =>
      requireOwner(headers).pipe(
        Effect.tap(() => requireBrowserLogin(headers)),
        Effect.tap(() => requireSameOrigin(headers)),
      ),
  })
})

export class ExeDevIdentity extends Context.Service<
  ExeDevIdentity,
  {
    readonly admitAgent: (
      headers: Headers.Headers,
    ) => Effect.Effect<MachineId, OwnerEmailRejected | MachineUnidentified>
    readonly admitPhonePage: (
      headers: Headers.Headers,
    ) => Effect.Effect<void, OwnerEmailRejected | BrowserLoginRequired>
    readonly admitPhoneSocket: (
      headers: Headers.Headers,
    ) => Effect.Effect<string, OwnerEmailRejected | BrowserLoginRequired | UpgradeOriginRejected>
  }
>()('@crook/hub/ExeDevIdentity') {
  static readonly layer = Layer.effect(this, make)
}
