import { cn } from 'cn'

export function OutputText({ text, className }: { text: string; className: string }) {
  return (
    <pre
      className={cn(
        'bg-muted/60 rounded-[calc(var(--radius)-0.25rem)] p-2.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap',
        className,
      )}
    >
      {text}
    </pre>
  )
}
