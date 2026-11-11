import { cn } from 'cn'
import { FileText, X } from 'lucide-react'
import * as React from 'react'

import { type DraftAttachment, sizeLabel } from '@crook/web/chat/Attachments'

const REMOVE_ICON_SIZE = 12
const FILE_ICON_SIZE = 16
const TILE = 'relative h-14 shrink-0 overflow-hidden rounded-[calc(var(--radius)-0.25rem)]'

const useBlobUrl = (attachment: DraftAttachment): string | undefined => {
  const [url, setUrl] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    const made = URL.createObjectURL(new Blob([attachment.bytes], { type: attachment.mediaType }))

    setUrl(made)

    return () => {
      URL.revokeObjectURL(made)
    }
  }, [attachment])

  return url
}

function ImageTile({ attachment }: { attachment: DraftAttachment }) {
  const url = useBlobUrl(attachment)

  return (
    <span className={cn(TILE, 'bg-muted block w-14')}>
      {url === undefined ? null : (
        <img src={url} alt={attachment.name} className="size-full object-cover" draggable={false} />
      )}
    </span>
  )
}

function FileTile({ attachment }: { attachment: DraftAttachment }) {
  return (
    <span
      className={cn(
        TILE,
        'border-border bg-muted/60 flex w-36 flex-col justify-center gap-0.5 border px-2.5',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
        <FileText
          aria-hidden="true"
          size={FILE_ICON_SIZE}
          className="text-muted-foreground shrink-0"
        />
        <span className="truncate">{attachment.name}</span>
      </span>
      <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
        {sizeLabel(attachment.bytes.byteLength)}
      </span>
    </span>
  )
}

export function AttachmentStrip({
  attachments,
  onRemove,
  disabled,
}: {
  attachments: readonly DraftAttachment[]
  onRemove: (attachment: DraftAttachment) => void
  disabled: boolean
}) {
  if (attachments.length === 0) {
    return null
  }

  return (
    <ul
      data-slot="attachment-strip"
      aria-label="Attachments"
      className="no-scrollbar flex gap-2 overflow-x-auto px-3 pt-3"
    >
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          data-slot="attachment"
          data-kind={attachment.kind}
          className="relative shrink-0 pt-1.5 pr-1.5"
        >
          {attachment.kind === 'image' ? (
            <ImageTile attachment={attachment} />
          ) : (
            <FileTile attachment={attachment} />
          )}
          <button
            type="button"
            aria-label={`Remove ${attachment.name}`}
            disabled={disabled}
            className="hit-area focus-visible:ring-ring bg-foreground text-background absolute top-0 right-0 inline-flex size-5 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            onClick={() => {
              onRemove(attachment)
            }}
          >
            <X aria-hidden="true" size={REMOVE_ICON_SIZE} strokeWidth={2.5} />
          </button>
        </li>
      ))}
    </ul>
  )
}
