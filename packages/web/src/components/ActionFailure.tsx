import * as Option from 'effect/Option'

export function ActionFailure({ message }: { message: Option.Option<string> }) {
  return Option.match(message, {
    onNone: () => null,
    onSome: (text) => (
      <p role="alert" className="text-destructive text-sm leading-5">
        {text}
      </p>
    ),
  })
}
