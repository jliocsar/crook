import { createFileRoute } from '@tanstack/react-router'

import { MachinesScreen } from '@crook/web/machines/MachinesScreen'

export const Route = createFileRoute('/machines')({ component: MachinesScreen })
