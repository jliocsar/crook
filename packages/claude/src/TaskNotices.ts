import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'

import { parseLine } from '@crook/claude/TranscriptParser'
import type { TranscriptOffset } from '@crook/domain/Ids'
import { Subagent, type SubagentStatus, statusOfNotice } from '@crook/domain/Subagent'
import type { TaskNotificationBlock, TranscriptMessage } from '@crook/domain/TranscriptMessage'

export type TaskNotices = HashMap.HashMap<string, TaskNotificationBlock>

const NOTICE_MARKER = '<task-notification>'

const decoder = new TextDecoder()

export const NO_TASK_NOTICES: TaskNotices = HashMap.empty()

export const taskNoticeLines = (
  bytes: Uint8Array,
  offset: TranscriptOffset,
): readonly TranscriptMessage[] =>
  decoder.decode(bytes).includes(NOTICE_MARKER) ? parseLine(bytes, offset) : []

export const taskNoticesIn = (
  messages: readonly TranscriptMessage[],
): readonly TaskNotificationBlock[] =>
  Arr.flatMap(messages, (message) =>
    Match.value(message).pipe(
      Match.tag('User', (user) =>
        Arr.flatMap(user.blocks, (block) =>
          Match.value(block).pipe(
            Match.tag('TaskNotification', (notice) => [notice]),
            Match.orElse(() => []),
          ),
        ),
      ),
      Match.orElse(() => []),
    ),
  )

export const withTaskNotices = (
  known: TaskNotices,
  messages: readonly TranscriptMessage[],
): TaskNotices =>
  Arr.reduce(taskNoticesIn(messages), known, (notices, notice) =>
    Option.match(notice.toolUseId, {
      onNone: () => notices,
      onSome: (toolUseId) => HashMap.set(notices, toolUseId, notice),
    }),
  )

export const noticeOutcome = (notice: TaskNotificationBlock): Option.Option<SubagentStatus> =>
  Option.map(notice.status, statusOfNotice)

export const settledSubagent =
  (notices: TaskNotices) =>
  (subagent: Subagent): Subagent =>
    pipe(
      subagent.toolUseId,
      Option.flatMap((toolUseId) => HashMap.get(notices, toolUseId)),
      Option.flatMap(noticeOutcome),
      Option.match({
        onNone: () => subagent,
        onSome: (status) => new Subagent(Struct.evolve(subagent, { status: () => status })),
      }),
    )

export const settledRoster = (
  roster: readonly Subagent[],
  notices: TaskNotices,
): readonly Subagent[] => Arr.map(roster, settledSubagent(notices))
