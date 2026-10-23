import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

const STATUS_UNAUTHORIZED = 401
const STATUS_FORBIDDEN = 403

export const STATUS_NO_DEVICE_ACCEPTED = 502

const HARK_REQUIRED_SCOPES =
  'notifications:send, interactions:create, interactions:read and activities:write'

const refusalHint = (status: number) =>
  Match.value(status).pipe(
    Match.when(
      STATUS_UNAUTHORIZED,
      () =>
        'The token is unknown, revoked or expired: make a new agent token on hark.ryan.ceo and set CROOK_HUB_HARK_TOKEN on the hub to it.',
    ),
    Match.when(
      STATUS_FORBIDDEN,
      () =>
        `The token lacks a scope the hub needs: make a new agent token with ${HARK_REQUIRED_SCOPES}, and set CROOK_HUB_HARK_TOKEN on the hub to it.`,
    ),
    Match.when(
      STATUS_NO_DEVICE_ACCEPTED,
      () =>
        'No phone accepted the removal, so the notification may stay on the lock screen until it is cleared there.',
    ),
    Match.orElse(() => 'The hub log names the request that failed.'),
  )

const quoted = (explanation: Option.Option<string>) =>
  Option.match(explanation, {
    onNone: () => '',
    onSome: (said) => ` ("${said}")`,
  })

export class HarkNotConfigured extends Schema.TaggedError<HarkNotConfigured>()(
  'HarkNotConfigured',
  {},
) {
  override get message(): string {
    return `The hub has no Hark token, so it sends no notifications, approvals or Live Activity. Set CROOK_HUB_HARK_TOKEN on the hub to a Hark agent token with the ${HARK_REQUIRED_SCOPES} scopes, then restart the hub.`
  }
}

export class HarkRefused extends Schema.TaggedError<HarkRefused>()('HarkRefused', {
  status: Schema.Int,
  explanation: Schema.OptionFromNullOr(Schema.String),
}) {
  override get message(): string {
    return `Hark refused the request with status ${this.status}${quoted(this.explanation)}. ${refusalHint(this.status)}`
  }
}

export class HarkRateLimited extends Schema.TaggedError<HarkRateLimited>()('HarkRateLimited', {
  retryAfterSeconds: Schema.OptionFromNullOr(Schema.Int),
}) {
  override get message(): string {
    return Option.match(this.retryAfterSeconds, {
      onNone: () =>
        "Hark refused the request because the account's monthly notification allowance is used up. Notifications resume next month, or on a Hark plan with a larger allowance.",
      onSome: (seconds) =>
        `Hark refused the request because its per-minute limit was reached: something besides this hub is sending with the same Hark account. Try again in ${seconds} s.`,
    })
  }
}

export class HarkServerFailed extends Schema.TaggedError<HarkServerFailed>()('HarkServerFailed', {
  status: Schema.Int,
  explanation: Schema.OptionFromNullOr(Schema.String),
}) {
  override get message(): string {
    return `Hark failed on its side with status ${this.status}${quoted(this.explanation)}. The hub tries its notifications again later; for a test, try again in a few minutes.`
  }
}

export class HarkStillProcessing extends Schema.TaggedError<HarkStillProcessing>()(
  'HarkStillProcessing',
  {},
) {
  override get message(): string {
    return 'Hark is still processing an identical earlier request with the same idempotency key, so the hub asks again on its next turn.'
  }
}

export class HarkUnreachable extends Schema.TaggedError<HarkUnreachable>()('HarkUnreachable', {
  detail: Schema.String,
}) {
  override get message(): string {
    return `The hub could not reach Hark: ${this.detail}. Check the hub's network, then try again.`
  }
}

export class HarkAnswerUnreadable extends Schema.TaggedError<HarkAnswerUnreadable>()(
  'HarkAnswerUnreadable',
  { detail: Schema.String },
) {
  override get message(): string {
    return `Hark answered with something the hub cannot read: ${this.detail}. Hark's API may have changed; check its OpenAPI document against this hub.`
  }
}

export class HarkReachedNoDevice extends Schema.TaggedError<HarkReachedNoDevice>()(
  'HarkReachedNoDevice',
  {},
) {
  override get message(): string {
    return 'Hark took the notification, but no iPhone accepted it. Open Hark for iPhone, sign in to the account the hub token belongs to and allow notifications, then send another test.'
  }
}

export const HarkFailure = Schema.Union([
  HarkNotConfigured,
  HarkRefused,
  HarkRateLimited,
  HarkServerFailed,
  HarkStillProcessing,
  HarkUnreachable,
  HarkAnswerUnreadable,
])
export type HarkFailure = typeof HarkFailure.Type

export const TestNotificationFailure = Schema.Union([...HarkFailure.members, HarkReachedNoDevice])
export type TestNotificationFailure = typeof TestNotificationFailure.Type
