import { cn } from 'cn'
import * as Equal from 'effect/Equal'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as React from 'react'

import type { Ask, AskQuestion, PermissionAsk, QuestionAsk, UnknownAsk } from '@crook/domain/Ask'
import { Choose } from '@crook/domain/Command'
import type { AskAnswer } from '@crook/domain/Command'
import {
  alwaysCaption,
  AskAnswerState,
  AskDetail,
  answerableQuestion,
  answerInFlight,
  askDetail,
  askTitle,
  askTool,
  isAnswerUnderway,
  laptopOnlyOptions,
  NEEDS_YOU,
  permissionButtons,
  PLAIN_DECLINE,
} from '@crook/web/chat/AskModel'
import type { AskButton } from '@crook/web/chat/AskModel'
import type { FloatingNotice } from '@crook/web/components/FloatingNotices'
import { OutputText } from '@crook/web/components/OutputText'
import { Button } from '@crook/web/components/ui/button'
import { CodeBlock } from '@crook/web/components/ui/code-block'
import { DiffView } from '@crook/web/components/ui/diff-view'
import { Questionnaire } from '@crook/web/components/ui/questionnaire'
import { Spinner } from '@crook/web/components/ui/spinner'
import { languageOfPath, SHELL_LANGUAGE } from '@crook/web/highlight/Highlighter'
import { SectionLabel } from '@crook/web/machines/SectionLabel'

export interface AskDockProps {
  readonly ask: Ask
  readonly cwd: string
  readonly state: AskAnswerState
  readonly disabled: boolean
  readonly onAnswer: (answer: AskAnswer) => void
  readonly onDeclineWithMessage: (text: string) => void
}

type AnswerControls = Pick<AskDockProps, 'state' | 'disabled' | 'onAnswer'>

const DETAIL_CAP = 'max-h-40 overflow-y-auto'
const DECLINE_LABEL = 'Decline'
const ANSWER_LABEL = 'Answer'
const ANSWERED_NOTE = 'Answered. Waiting for Claude to move on.'
const ALREADY_ANSWERED_NOTE = 'Already answered'
const ASK_NOTICE_ID = 'ask-answer'
const UNREADABLE_HINT = 'Decline it here, or tell Claude what to do instead.'
const LAPTOP_ONLY_CAPTION = 'Claude also offers these, on the laptop only:'

const QUESTIONNAIRE_HINT =
  'crook can only pick the answer to one question with one choice. Answer this one in the terminal, or tell Claude what to do instead.'

const DECLINE_BUTTONS: readonly AskButton[] = [{ label: DECLINE_LABEL, answer: PLAIN_DECLINE }]

const locked = (controls: AnswerControls): boolean =>
  controls.disabled || isAnswerUnderway(controls.state)

const askNotice = (tone: FloatingNotice['tone'], text: string): Option.Option<FloatingNotice> =>
  Option.some({ id: ASK_NOTICE_ID, tone, text })

export const askAnswerNotice = (state: AskAnswerState): Option.Option<FloatingNotice> =>
  AskAnswerState.$match(state, {
    Open: () => Option.none(),
    Answering: () => Option.none(),
    Answered: () => askNotice('quiet', ANSWERED_NOTE),
    AlreadyAnswered: () => askNotice('quiet', ALREADY_ANSWERED_NOTE),
    Refused: ({ message }) => askNotice('failure', message),
  })

function DetailView({ detail }: { detail: AskDetail }) {
  return AskDetail.$match(detail, {
    Command: ({ command }) => (
      <CodeBlock code={command} language={SHELL_LANGUAGE} wrap className={DETAIL_CAP} />
    ),
    Diff: ({ hunks, filename }) => (
      <DiffView hunks={hunks} filename={filename} className={DETAIL_CAP} />
    ),
    File: ({ content, filename }) => (
      <CodeBlock
        code={content}
        filename={filename}
        language={Option.getOrUndefined(languageOfPath(filename))}
        className={DETAIL_CAP}
      />
    ),
    Text: ({ text }) => <OutputText text={text} className={DETAIL_CAP} />,
    Summary: ({ text }) => <p className="truncate font-mono text-sm">{text}</p>,
  })
}

function AnswerButtons({
  buttons,
  controls,
}: {
  buttons: readonly AskButton[]
  controls: AnswerControls
}) {
  const answering = answerInFlight(controls.state)

  return (
    <div data-slot="ask-answers" className="grid auto-cols-fr grid-flow-col gap-2">
      {buttons.map((button, index) => (
        <Button
          key={button.label}
          size="touch"
          variant={index === 0 ? 'default' : 'outline'}
          className="text-base"
          disabled={locked(controls)}
          onClick={() => {
            controls.onAnswer(button.answer)
          }}
        >
          {button.label}
          <Spinner
            pending={Option.exists(answering, (answer) => Equal.equals(answer, button.answer))}
          />
        </Button>
      ))}
    </div>
  )
}

function LaptopOnlyOptions({ labels }: { labels: readonly string[] }) {
  return labels.length === 0 ? null : (
    <div
      data-slot="ask-laptop-options"
      className="text-muted-foreground grid gap-0.5 text-xs leading-4"
    >
      <p>{LAPTOP_ONLY_CAPTION}</p>
      <ul className="list-disc ps-4">
        {labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </div>
  )
}

function PermissionDock({
  ask,
  cwd,
  controls,
}: {
  ask: PermissionAsk
  cwd: string
  controls: AnswerControls
}) {
  return (
    <>
      <div className="grid gap-0.5">
        <p className="text-base leading-6 font-semibold">{askTitle(ask)}</p>
        <p className="text-muted-foreground truncate font-mono text-xs">{askTool(ask)}</p>
      </div>
      <DetailView detail={askDetail(ask, cwd)} />
      <AnswerButtons buttons={permissionButtons(ask)} controls={controls} />
      {Option.match(alwaysCaption(ask), {
        onNone: () => null,
        onSome: (caption) => (
          <p data-slot="ask-always" className="text-muted-foreground text-xs leading-4">
            {caption}
          </p>
        ),
      })}
      <LaptopOnlyOptions labels={laptopOnlyOptions(ask)} />
    </>
  )
}

function QuestionList({ questions }: { questions: readonly AskQuestion[] }) {
  return (
    <div className={cn('grid gap-3', DETAIL_CAP)}>
      {questions.map((question) => (
        <div key={question.question} className="grid gap-1">
          <p className="text-muted-foreground font-mono text-xs">{question.header}</p>
          <p className="text-sm font-semibold">{question.question}</p>
          <ul className="text-muted-foreground list-disc ps-5 text-sm leading-5">
            {question.choices.map((choice) => (
              <li key={choice.label}>{choice.label}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function QuestionDock({
  ask,
  controls,
  onDeclineWithMessage,
}: {
  ask: QuestionAsk
  controls: AnswerControls
  onDeclineWithMessage: (text: string) => void
}) {
  return Option.match(answerableQuestion(ask), {
    onSome: (question) => (
      <>
        <p className="text-muted-foreground font-mono text-xs">{question.header}</p>
        <Questionnaire
          prompt={question.question}
          choices={question.choices.map((choice) => ({
            id: choice.label,
            label: choice.label,
            description: Option.getOrUndefined(choice.description),
          }))}
          submitLabel={ANSWER_LABEL}
          disabled={locked(controls)}
          pending={isAnswerUnderway(controls.state)}
          onChoose={(label) => {
            controls.onAnswer(new Choose({ answer: label }))
          }}
          onFreeform={onDeclineWithMessage}
        />
      </>
    ),
    onNone: () => (
      <>
        <QuestionList questions={ask.questions} />
        <p className="text-muted-foreground text-sm leading-5">{QUESTIONNAIRE_HINT}</p>
        <AnswerButtons buttons={DECLINE_BUTTONS} controls={controls} />
      </>
    ),
  })
}

function UnknownDock({ ask, controls }: { ask: UnknownAsk; controls: AnswerControls }) {
  return (
    <>
      <p className="text-base leading-6 font-semibold">{askTitle(ask)}</p>
      <OutputText text={ask.screen} className={DETAIL_CAP} />
      <p className="text-muted-foreground text-sm leading-5">{UNREADABLE_HINT}</p>
      <AnswerButtons buttons={DECLINE_BUTTONS} controls={controls} />
    </>
  )
}

export function AskDock({
  ask,
  cwd,
  ref,
  onDeclineWithMessage,
  ...controls
}: AskDockProps & { readonly ref?: React.Ref<HTMLElement> }) {
  const labelId = React.useId()

  return (
    <section
      ref={ref}
      data-slot="ask-dock"
      aria-labelledby={labelId}
      className="-mx-1 flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-1 pb-1 *:shrink-0"
    >
      <SectionLabel id={labelId} className="text-primary px-0 pb-0">
        {NEEDS_YOU}
      </SectionLabel>
      {Match.value(ask).pipe(
        Match.tagsExhaustive({
          PermissionAsk: (permission): React.ReactNode => (
            <PermissionDock ask={permission} cwd={cwd} controls={controls} />
          ),
          QuestionAsk: (question): React.ReactNode => (
            <QuestionDock
              ask={question}
              controls={controls}
              onDeclineWithMessage={onDeclineWithMessage}
            />
          ),
          UnknownAsk: (unknown): React.ReactNode => (
            <UnknownDock ask={unknown} controls={controls} />
          ),
        }),
      )}
    </section>
  )
}
