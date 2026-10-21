import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Record from 'effect/Record'

import { CLAUDE_HOOK_EVENTS } from '@crook/claude/HookPayload'

export const claudeHookSettings = (command: string) => ({
  hooks: pipe(
    CLAUDE_HOOK_EVENTS,
    Arr.map((event) => [event, [{ hooks: [{ type: 'command', command, async: true }] }]] as const),
    Record.fromEntries,
  ),
})
