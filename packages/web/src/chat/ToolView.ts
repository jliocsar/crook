import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import type { PatchHunk, ToolResultBlock } from '@crook/domain/TranscriptMessage'
import { imagesIn, textsIn } from '@crook/web/chat/Blocks'
import { stringField } from '@crook/web/chat/ChatItems'
import type { SubagentRun, ToolCallModel } from '@crook/web/chat/ChatItems'
import type { Picture } from '@crook/web/chat/Images'
import type { DiffHunk } from '@crook/web/components/ui/diff-view'
import type { AgentRun } from '@crook/web/components/ui/subagent-tree'
import { LINE_BREAK } from '@crook/web/text/Lines'
import { runningSpan } from '@crook/web/time/Elapsed'

export interface RunView {
  readonly now: DateTime.Utc
  readonly paneClosed: boolean
  readonly opensRuns: boolean
}

const PATH_FIELD = 'file_path'
const PANE_CLOSED_NOTE = 'Pane closed'
const BYTES_PER_KILOBYTE = 1024
const READ_LINE_NUMBER = /^\s*\d+(?:\t|→)/u

const EditInput = Schema.Struct({ old_string: Schema.String, new_string: Schema.String })

const decodeEditInput = Schema.decodeUnknownOption(EditInput)

export const resultText = (result: ToolResultBlock): string =>
  Arr.join(textsIn(result.content), LINE_BREAK)

export const withoutLineNumbers = (text: string): string =>
  pipe(
    Option.liftPredicate(text.split(LINE_BREAK), (lines) =>
      lines.every((line) => line === '' || READ_LINE_NUMBER.test(line)),
    ),
    Option.map((lines) =>
      pipe(
        lines,
        Arr.map((line) => line.replace(READ_LINE_NUMBER, '')),
        Arr.join(LINE_BREAK),
      ),
    ),
    Option.getOrElse(() => text),
  )

const fileName = (path: string): string => path.split('/').at(-1) ?? path

export const pathOf = (call: ToolCallModel): Option.Option<string> =>
  stringField(call.input, PATH_FIELD)

export const picturesOf = (call: ToolCallModel): readonly Picture[] => {
  const name = Option.getOrElse(Option.map(pathOf(call), fileName), () => `${call.name} image`)

  return Option.match(call.result, {
    onNone: () => [],
    onSome: (result) => imagesIn(result.content).map((image) => ({ image, name })),
  })
}

export const inputHunks = (call: ToolCallModel): Option.Option<readonly DiffHunk[]> =>
  Option.map(decodeEditInput(call.input), (edit) => [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        ...edit.old_string.split(LINE_BREAK).map((line) => `-${line}`),
        ...edit.new_string.split(LINE_BREAK).map((line) => `+${line}`),
      ],
    },
  ])

export const patchHunks = (call: ToolCallModel): Option.Option<readonly PatchHunk[]> =>
  pipe(
    call.result,
    Option.flatMap((result) => result.patch),
    Option.filter(Arr.isReadonlyArrayNonEmpty),
  )

export const toolDuration = (call: ToolCallModel, now: DateTime.Utc): string | undefined =>
  Option.getOrUndefined(
    runningSpan(call.startedAt, call.finishedAt, call.status === 'running', now),
  )

const runMeta = (run: SubagentRun): string =>
  pipe(
    [Option.some(run.agentType), run.model],
    Arr.getSomes,
    Arr.filter((part) => part !== ''),
    Arr.join(' · '),
  )

export const runStatusShown = (run: SubagentRun, paneClosed: boolean): SubagentRun['status'] =>
  paneClosed && run.status === 'running' ? 'failed' : run.status

export const treeRun = (run: SubagentRun, view: RunView): AgentRun => {
  const status = runStatusShown(run, view.paneClosed)

  return {
    id: run.toolUseId,
    label: run.description,
    status,
    meta: status === 'failed' && run.status === 'running' ? PANE_CLOSED_NOTE : runMeta(run),
    duration: Option.getOrUndefined(
      runningSpan(run.startedAt, run.finishedAt, status === 'running', view.now),
    ),
    selectable: view.opensRuns && Option.isSome(run.subagent),
  }
}

export const omittedLabel = (byteLength: number): string =>
  `Earlier messages not loaded (${Math.ceil(byteLength / BYTES_PER_KILOBYTE)} KB)`
