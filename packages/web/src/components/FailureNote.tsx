import { cn } from 'cn'

export function FailureNote({ message, className }: { message: string; className?: string }) {
  return (
    <p role="alert" className={cn('text-destructive text-sm leading-5', className)}>
      {message}
    </p>
  )
}
