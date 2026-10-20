import { createFileRoute } from '@tanstack/react-router'

import { HerdScreen } from '@crook/web/herd/HerdScreen'

export const Route = createFileRoute('/_agents')({ component: HerdScreen })
