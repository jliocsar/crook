import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import { constVoid } from 'effect/Function'
import * as Option from 'effect/Option'
import * as React from 'react'

import { ClaudeSessionId, TranscriptOffset } from '@crook/domain/Ids'
import {
  AssistantMessage,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
  UserMessage,
} from '@crook/domain/TranscriptMessage'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import { useItemRows } from '@crook/web/chat/ChatRows'
import { useChatItems } from '@crook/web/chat/OpenedChat'
import type { ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import { NO_ROSTERS } from '@crook/web/chat/TranscriptState'
import { MeasuredSkeleton } from '@crook/web/components/MeasuredSkeleton'
import { FrozenScope } from '@crook/web/navigation/Covered'

const SAMPLE_SESSION = ClaudeSessionId.make('00000000-0000-4000-8000-000000000000')
const SAMPLE_FOLDER = '/project'
const SAMPLE_CONTEXT = { cwd: SAMPLE_FOLDER, activity: 'still', rosters: NO_ROSTERS } as const
const SAMPLE_START = DateTime.makeUnsafe('2026-01-01T00:00:00Z')

const offsetOf = (position: number) => TranscriptOffset.make(position)

const stampOf = (position: number) => Option.some(DateTime.add(SAMPLE_START, { seconds: position }))

const userSaid = (position: number, text: string): TranscriptMessage =>
  new UserMessage({
    offset: offsetOf(position),
    uuid: Option.none(),
    timestamp: stampOf(position),
    isMeta: false,
    origin: Option.none(),
    queued: false,
    blocks: [new TextBlock({ text })],
  })

const assistantDid = (position: number, blocks: AssistantMessage['blocks']): TranscriptMessage =>
  new AssistantMessage({
    offset: offsetOf(position),
    uuid: Option.none(),
    timestamp: stampOf(position),
    apiMessageId: Option.none(),
    model: Option.none(),
    stopReason: Option.none(),
    isApiError: false,
    blocks,
  })

const assistantSaid = (position: number, text: string): TranscriptMessage =>
  assistantDid(position, [new TextBlock({ text })])

const assistantRan = (position: number, id: string, name: string, path: string) =>
  assistantDid(position, [new ToolUseBlock({ id, name, input: { file_path: path } })])

const toolAnswered = (position: number, id: string): TranscriptMessage =>
  new UserMessage({
    offset: offsetOf(position),
    uuid: Option.none(),
    timestamp: stampOf(position),
    isMeta: false,
    origin: Option.none(),
    queued: false,
    blocks: [
      new ToolResultBlock({
        toolUseId: id,
        isError: false,
        content: [new TextBlock({ text: 'ok' })],
        patch: Option.none(),
        subagent: Option.none(),
        task: Option.none(),
      }),
    ],
  })

const SAMPLE_MESSAGES: readonly TranscriptMessage[] = [
  userSaid(0, 'Can you tidy the settings screen and make the toggles line up?'),
  assistantSaid(1, 'Reading the screen and how it lays out its rows first.'),
  assistantRan(2, 'sample-a', 'Read', 'src/Settings.tsx'),
  toolAnswered(3, 'sample-a'),
  assistantSaid(
    4,
    'The rows use two different paddings. I will move both to the same spacing and keep every label on one line, so the toggles sit in one column down the screen.',
  ),
  userSaid(5, 'Good, go ahead, and run the tests after.'),
  assistantRan(6, 'sample-b', 'Edit', 'src/ToggleRow.tsx'),
  toolAnswered(7, 'sample-b'),
  assistantRan(8, 'sample-c', 'Edit', 'src/Settings.tsx'),
  toolAnswered(9, 'sample-c'),
  assistantSaid(
    10,
    'Done. The toggles line up and the suite passes. The one thing left is the account section, which keeps its own spacing on purpose since it holds no toggles at all.',
  ),
  userSaid(11, 'Thanks. Does the same spacing hold in the sheet that opens from the section?'),
  assistantRan(12, 'sample-d', 'Read', 'src/Account.tsx'),
  toolAnswered(13, 'sample-d'),
  assistantSaid(
    14,
    'It does. The sheet reads the same tokens as the screen, so nothing needs to change there.',
  ),
]

const SAMPLE_LINES = Arr.map(SAMPLE_MESSAGES, (message) => ({
  session: SAMPLE_SESSION,
  message,
}))

const SAMPLE_ENVIRONMENT: ThreadEnvironment = {
  cwd: SAMPLE_FOLDER,
  paneClosed: false,
  onShowEarlier: constVoid,
  earlierPending: false,
  onOpenRun: Option.none(),
}

function SampleRows() {
  const items = useChatItems(SAMPLE_LINES, SAMPLE_CONTEXT)
  const rows = useItemRows(items, SAMPLE_ENVIRONMENT)

  return rows.map((row) => <React.Fragment key={row.key}>{row.content}</React.Fragment>)
}

export function ThreadSkeleton() {
  return (
    <MeasuredSkeleton
      slot="thread-skeleton"
      label="Loading the conversation"
      className="absolute inset-0 flex flex-col justify-end overflow-hidden px-4 pb-4"
    >
      <FrozenScope>
        <div data-slot="thread-sample" className="flex flex-col gap-3">
          <SampleRows />
        </div>
      </FrozenScope>
    </MeasuredSkeleton>
  )
}
