import { createFileRoute } from '@tanstack/react-router'

import { SettingsScreen } from '@crook/web/settings/SettingsScreen'

export const Route = createFileRoute('/settings')({ component: SettingsScreen })
