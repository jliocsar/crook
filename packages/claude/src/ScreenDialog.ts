import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Hash from 'effect/Hash'
import * as Option from 'effect/Option'
import * as Str from 'effect/String'

export type DialogKind = 'permission' | 'question'

export interface DialogOption {
  readonly number: number
  readonly label: string
  readonly selected: boolean
  readonly details: readonly string[]
}

export interface DialogQueue {
  readonly position: number
  readonly total: number
}

export interface ScreenDialog {
  readonly kind: DialogKind
  readonly header: string
  readonly plugin: Option.Option<string>
  readonly queue: Option.Option<DialogQueue>
  readonly subject: Option.Option<string>
  readonly body: readonly string[]
  readonly prompt: readonly string[]
  readonly options: readonly DialogOption[]
  readonly text: string
}

interface HeaderParts {
  readonly title: string
  readonly plugin: Option.Option<string>
  readonly queue: Option.Option<DialogQueue>
}

interface DialogSections {
  readonly preamble: readonly string[]
  readonly body: readonly string[]
  readonly rest: readonly string[]
}

const FOOTER_MARK = 'Esc to cancel'
const QUESTION_MARK = '☐'
const TIP_PREFIX = 'Tip:'
const RULE = /^─+$/u
const DASHED_RULE = /^╌+$/u
const OPTION_LINE = /^\s*(?<cursor>❯\s+)?(?<number>\d+)\.\s+(?<label>.*)$/u

const HEADER =
  /^(?<title>.*?)(?:\s+·\s+from the (?<plugin>.+?) plugin)?(?:\s+(?<position>\d+) of (?<total>\d+))?$/u

const NAVIGATE_DOWN = 'down'
const NAVIGATE_UP = 'up'
const CONFIRM = 'enter'
const FINGERPRINT_SEPARATOR = '\u0000'

const isRule = (line: string) => RULE.test(line.trim())

const isDashedRule = (line: string) => DASHED_RULE.test(line.trim())

const isOptionLine = (line: string) => OPTION_LINE.test(line)

const isBlank = (line: string) => line.trim().length === 0

const withoutIndent = (line: string) => (line.startsWith(' ') ? line.slice(1) : line).trimEnd()

const nextContent = (lines: readonly string[], from: number) =>
  pipe(lines, Arr.drop(from), Arr.findFirst(Str.isNonEmpty))

const footerIndex = (lines: readonly string[]) =>
  Arr.findLastIndex(lines, (line) => line.includes(FOOTER_MARK))

const startsDialog = (lines: readonly string[]) => (index: number) =>
  isRule(lines[index] ?? '') &&
  Option.exists(
    nextContent(
      lines.map((line) => line.trim()),
      index + 1,
    ),
    (line) => !isOptionLine(line) && !isRule(line),
  )

const dialogStart = (lines: readonly string[], footer: number) =>
  pipe(Arr.range(0, footer), Arr.reverse, Arr.findFirst(startsDialog(lines)))

const parseHeader = (line: string): HeaderParts =>
  pipe(
    Option.fromNullishOr(HEADER.exec(line.trim())?.groups),
    Option.match({
      onNone: () => ({ title: line.trim(), plugin: Option.none(), queue: Option.none() }),
      onSome: (groups) => ({
        title: (groups['title'] ?? line).trim(),
        plugin: Option.fromNullishOr(groups['plugin']),
        queue: Option.map(
          Option.all([
            Option.fromNullishOr(groups['position']),
            Option.fromNullishOr(groups['total']),
          ]),
          ([position, total]) => ({ position: Number(position), total: Number(total) }),
        ),
      }),
    }),
  )

const optionOf = (line: string): Option.Option<DialogOption> =>
  pipe(
    Option.fromNullishOr(OPTION_LINE.exec(line)?.groups),
    Option.map((groups) => ({
      number: Number(groups['number']),
      label: (groups['label'] ?? '').trim(),
      selected: groups['cursor'] !== undefined,
      details: [],
    })),
  )

const withDetail = (options: readonly DialogOption[], line: string): readonly DialogOption[] =>
  Arr.match(options, {
    onEmpty: () => options,
    onNonEmpty: (nonEmpty) =>
      Arr.modifyLastNonEmpty(nonEmpty, (last) => ({
        ...last,
        details: [...last.details, line.trim()],
      })),
  })

const NO_OPTIONS: readonly DialogOption[] = []

const collectOptions = (lines: readonly string[]): readonly DialogOption[] =>
  Arr.reduce(lines, NO_OPTIONS, (options, line) =>
    Option.match(optionOf(line), {
      onNone: () => (isBlank(line) || isRule(line) ? options : withDetail(options, line)),
      onSome: (option) => [...options, option],
    }),
  )

const sectionsOf = (lines: readonly string[]): DialogSections => {
  const rules = Arr.flatMap(lines, (line, index) => (isDashedRule(line) ? [index] : []))
  const firstOption = Option.getOrElse(Arr.findFirstIndex(lines, isOptionLine), () => lines.length)

  return pipe(
    Option.all([Arr.get(rules, 0), Arr.get(rules, 1)]),
    Option.match({
      onNone: () => ({
        preamble: [],
        body: lines.slice(0, firstOption),
        rest: lines.slice(firstOption),
      }),
      onSome: ([opening, closing]) => ({
        preamble: lines.slice(0, opening),
        body: lines.slice(opening + 1, closing),
        rest: lines.slice(closing + 1),
      }),
    }),
  )
}

const contentLines = (lines: readonly string[]) =>
  pipe(
    lines,
    Arr.filter((line) => !isBlank(line)),
    Arr.map(withoutIndent),
  )

const promptLines = (rest: readonly string[]) =>
  pipe(
    rest,
    Arr.takeWhile((line) => !isOptionLine(line)),
    contentLines,
    Arr.map((line) => line.trim()),
  )

const buildDialog = (lines: readonly string[]): Option.Option<ScreenDialog> =>
  pipe(
    Arr.findFirstIndex(lines, (line) => !isBlank(line)),
    Option.map((headerIndex) => {
      const headerLine = (lines[headerIndex] ?? '').trim()
      const kind: DialogKind = headerLine.startsWith(QUESTION_MARK) ? 'question' : 'permission'
      const header = parseHeader(
        kind === 'question' ? headerLine.slice(QUESTION_MARK.length) : headerLine,
      )
      const sections = sectionsOf(lines.slice(headerIndex + 1))

      return {
        kind,
        header: header.title,
        plugin: header.plugin,
        queue: header.queue,
        subject: pipe(
          contentLines(sections.preamble),
          Arr.map((line) => line.trim()),
          Arr.findFirst((line) => !line.startsWith(TIP_PREFIX)),
        ),
        body: contentLines(sections.body),
        prompt: promptLines(sections.rest),
        options: collectOptions(sections.rest),
        text: contentLines(lines).join('\n'),
      }
    }),
    Option.filter((dialog) => Arr.isReadonlyArrayNonEmpty(dialog.options)),
  )

export const parseDialog = (screen: string): Option.Option<ScreenDialog> => {
  const lines = Str.split(screen, '\n')

  return pipe(
    footerIndex(lines),
    Option.flatMap((index) =>
      Option.map(dialogStart(lines, index), (start) => lines.slice(start + 1, index)),
    ),
    Option.flatMap(buildDialog),
  )
}

export const dialogFingerprint = (dialog: ScreenDialog): string =>
  String(
    Hash.string(
      [
        dialog.kind,
        dialog.header,
        Option.getOrElse(dialog.plugin, () => ''),
        Option.match(dialog.queue, { onNone: () => '', onSome: (queue) => String(queue.position) }),
        Option.getOrElse(dialog.subject, () => ''),
        ...dialog.body,
        ...dialog.prompt,
        ...dialog.options.flatMap((option) => [option.label, ...option.details]),
      ].join(FINGERPRINT_SEPARATOR),
    ),
  )

export const keysToSelect = (
  dialog: ScreenDialog,
  optionNumber: number,
): Option.Option<Arr.NonEmptyReadonlyArray<string>> =>
  pipe(
    Arr.findFirst(dialog.options, (option) => option.selected),
    Option.filter(() => Arr.some(dialog.options, (option) => option.number === optionNumber)),
    Option.map((selected) => {
      const distance = optionNumber - selected.number
      const navigation =
        distance === 0
          ? []
          : Arr.replicate(distance > 0 ? NAVIGATE_DOWN : NAVIGATE_UP, Math.abs(distance))

      return Arr.append(navigation, CONFIRM)
    }),
  )
