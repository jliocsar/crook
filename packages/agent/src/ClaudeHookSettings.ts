import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Record from 'effect/Record'
import * as Schema from 'effect/Schema'

import { CLAUDE_HOOK_EVENTS } from '@crook/claude/HookPayload'

const HOOKS_BLOCK_INDENT = 2

const encodeHooksBlock = Schema.encodeSync(
  Schema.fromJsonString(Schema.Json, { space: HOOKS_BLOCK_INDENT }),
)

const claudeHookSettings = (command: string) => ({
  hooks: pipe(
    CLAUDE_HOOK_EVENTS,
    Arr.map((event) => [event, [{ hooks: [{ type: 'command', command, async: true }] }]] as const),
    Record.fromEntries,
  ),
})

export const hooksBlock = (command: string) => encodeHooksBlock(claudeHookSettings(command))
