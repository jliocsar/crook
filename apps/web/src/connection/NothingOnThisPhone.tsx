import { EmptyState } from '@crook/web/components/ui/empty-state'

const THEY_SHOW = 'They show once crook reconnects.'

export function NothingOnThisPhone({
  title,
  description = THEY_SHOW,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="px-4 pt-6">
      <EmptyState title={title} description={description} />
    </div>
  )
}
