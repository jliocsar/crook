import { cn } from 'cn'
import * as Option from 'effect/Option'

export function ActionFailure({
  message,
  className,
}: {
  message: Option.Option<string>
  className?: string
}) {
  return Option.match(message, {
    onNone: () => null,
    onSome: (text) => (
      <p role="alert" className={cn('text-destructive text-sm leading-5', className)}>
        {text}
      </p>
    ),
  })
}
