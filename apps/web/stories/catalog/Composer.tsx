import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { interrupt } from '@crook/domain/Command'
import { SkillListing } from '@crook/domain/Skill'
import { SkillsChanged } from '@crook/domain/Transcript'
import {
  CLAUDE_WAITING_NOTE,
  HerdrUnavailable,
  claudeWaitingRefusal,
} from '@crook/protocol/Commands'
import { REDIALING, UNREACHABLE } from '@crook/web/rpc/HubLinkState'
import { UploadUnreachable } from '@crook/web/rpc/HubUploads'

import { liveWith, stateWith } from '../../test/AppWiring.tsx'
import {
  chunk,
  opened,
  prompt,
  said,
  caughtUp,
  SESSION,
  user,
} from '../../test/TranscriptFixtures.ts'
import { TextBlock } from '@crook/domain/TranscriptMessage'
import { chatHerd, chatStory, delivered, opensWith, SEND_READY } from '../ChatFixtures.ts'
import { chatAgent, chatAgentSaying, CONVERSATION, PANE } from '../Fixtures.ts'
import { inputDelivered } from '../../test/HubFakes.ts'
import { herd, LAPTOP, machine } from '../../test/HerdFixtures.ts'
import { buildLog, LOG_NAME, threeFiles } from '../AttachmentFixtures.ts'
import { clicks, pastes, seesText, types } from '../StageDom.ts'
import { step } from '../Story.tsx'
import type { LinkStage, StoryMaker } from '../Story.tsx'

const LONG_DRAFT =
  'A long draft that wraps over several lines, because the phone is narrow and the thought is not, and it keeps on going past where the field stops growing, so the field has to scroll inside itself by the end of it.'

const FIELD = /Message|Reply|Sending is paused|Tell Claude/u
const SEND = 'Send'
const STOP = 'Stop (Esc)'
const TEXTAREA = 'textarea'
const DRAFT = 'Now check the toast too'
const REFUSED_SEND = new HerdrUnavailable().message

const typesDraft = (text: string) => Effect.flatMap(Effect.void, () => types(FIELD, text))

const SKILLS = new SkillsChanged({
  session: SESSION,
  skills: [
    new SkillListing({
      name: 'handoff',
      description: 'Compact the conversation into a handoff document',
      argumentHint: Option.some('What will the next session be used for?'),
      scope: 'project',
    }),
    new SkillListing({
      name: 'adhd',
      description: 'Restate the next steps',
      argumentHint: Option.none(),
      scope: 'personal',
    }),
    new SkillListing({
      name: 'plugin:deploy',
      description: 'Deploy the thing',
      argumentHint: Option.none(),
      scope: 'plugin',
    }),
  ],
})

const ATTACHMENT = '[data-slot="attachment"]'
const OLD_AGENT = '0.0.13'
const ATTACH_BUTTON = 'Attach a photo or file'

const pastesFiles = (files: Effect.Effect<readonly File[]>) =>
  Effect.flatMap(files, (pasted) => pastes(FIELD, pasted))

const attachedThree = Effect.andThen(pastesFiles(threeFiles), seesText(LOG_NAME))

export const COMPOSER_STORIES: readonly StoryMaker[] = [
  chatStory({
    slug: 'attached',
    title: 'Composer, a photo, a screenshot and a file attached',
    events: CONVERSATION,
    shows: { all: [{ selector: ATTACHMENT }, { text: LOG_NAME }, { selector: SEND_READY }] },
    settle: () => Effect.andThen(attachedThree, typesDraft(DRAFT)),
  }),
  chatStory({
    slug: 'attached-sent',
    title: 'Composer, a file sent with no words',
    events: CONVERSATION,
    arrange: ({ link }) =>
      Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(interrupt(PANE)))),
    shows: { text: `Attached ${LOG_NAME}` },
    settle: () =>
      Effect.andThen(
        Effect.andThen(pastesFiles(Effect.sync(() => [buildLog()])), seesText(LOG_NAME)),
        clicks(SEND),
      ),
  }),
  chatStory({
    slug: 'attached-upload-failed',
    title: 'Composer, an attachment the hub could not take',
    events: CONVERSATION,
    arrange: ({ link }) =>
      Ref.set(
        link.uploads.uploadRefusal,
        Option.some(new UploadUnreachable({ detail: 'offline' })),
      ),
    shows: { all: [{ selector: '[role="alert"]' }, { text: LOG_NAME }] },
    settle: () =>
      Effect.andThen(
        Effect.andThen(pastesFiles(Effect.sync(() => [buildLog()])), seesText(LOG_NAME)),
        clicks(SEND),
      ),
  }),
  chatStory({
    slug: 'attach-old-agent',
    title: 'Composer, an agent too old to take attachments',
    events: CONVERSATION,
    link: liveWith(herd([machine(LAPTOP, [chatAgent()], { agentVersion: OLD_AGENT })])),
    shows: { text: 'too old to take attachments' },
    settle: () => clicks(ATTACH_BUTTON),
  }),
  chatStory({
    slug: 'ready',
    title: 'Composer, ready',
    events: CONVERSATION,
    shows: { selector: TEXTAREA },
  }),
  chatStory({
    slug: 'draft',
    title: 'Composer, a draft typed',
    shows: { selector: SEND_READY },
    events: CONVERSATION,
    settle: () => typesDraft(DRAFT),
  }),
  chatStory({
    slug: 'draft-long',
    title: 'Composer, a draft that grows the field',
    shows: { field: LONG_DRAFT },
    events: CONVERSATION,
    settle: () => typesDraft(LONG_DRAFT),
  }),
  chatStory({
    slug: 'working',
    title: 'Composer, Stop while Claude works',
    row: chatAgent('working', 0),
    events: CONVERSATION,
    shows: { selector: `button[aria-label="${STOP}"]` },
  }),
  chatStory({
    slug: 'working-with-draft',
    title: 'Composer, a draft typed while Claude works',
    shows: { selector: SEND_READY },
    row: chatAgent('working', 0),
    events: CONVERSATION,
    settle: () => typesDraft(DRAFT),
  }),
  chatStory({
    slug: 'stopping',
    title: 'Composer, Stop pressed',
    shows: { selector: '[data-slot="prompt-input-stop"][aria-busy="true"]' },
    row: chatAgent('working', 0),
    events: CONVERSATION,
    arrange: ({ link }) =>
      Effect.andThen(
        Ref.set(link.commandAnswer, Exit.fail(new HerdrUnavailable())),
        link.commandAnswers.close,
      ),
    settle: () => clicks(STOP),
  }),
  chatStory({
    slug: 'sending-quiet',
    title: 'Composer, Sending, in the second before the spinner',
    shows: { selector: '[data-slot="prompt-input-submit"][aria-busy="true"]' },
    events: CONVERSATION,
    arrange: (stage) => Effect.andThen(delivered(stage, DRAFT), stage.link.commandAnswers.close),
    settle: () => Effect.andThen(typesDraft(DRAFT), clicks(SEND)),
  }),
  chatStory({
    slug: 'sending',
    title: 'Composer, Sending past the delay, with its spinner',
    shows: { selector: '[data-slot="prompt-input-submit"] [data-slot="spinner"]' },
    events: CONVERSATION,
    arrange: (stage) => Effect.andThen(delivered(stage, DRAFT), stage.link.commandAnswers.close),
    settle: () => Effect.andThen(typesDraft(DRAFT), clicks(SEND)),
  }),
  chatStory({
    slug: 'send-answered-past-the-delay',
    title: 'Composer, a send answered just past the delay, its spinner staying for its minimum',
    shows: { selector: SEND_READY },
    ends: { text: 'Sent' },
    events: CONVERSATION,
    arrange: (stage) => Effect.andThen(delivered(stage, DRAFT), stage.link.commandAnswers.close),
    settle: () => typesDraft(DRAFT),
    timeline: [
      step<LinkStage>(400, 'Tap Send', () => clicks(SEND)),
      step<LinkStage>(1100, 'The hub answers', ({ link }) => link.commandAnswers.open),
      step<LinkStage>(800, 'The spinner has had its minimum and fade', () => Effect.void),
    ],
  }),
  chatStory({
    slug: 'send-failed-then-edited',
    title: 'Composer, a refused send, gone once the draft moves on',
    shows: { selector: '[role="alert"]' },
    ends: { absent: REFUSED_SEND },
    events: CONVERSATION,
    arrange: ({ link }) => Ref.set(link.commandAnswer, Exit.fail(new HerdrUnavailable())),
    settle: () => Effect.andThen(typesDraft(DRAFT), clicks(SEND)),
    timeline: [step<LinkStage>(800, 'Type on', () => typesDraft(' and the banner'))],
  }),
  chatStory({
    slug: 'stop-failed',
    title: 'Composer, a refused Stop',
    shows: { selector: '[role="alert"]' },
    row: chatAgent('working', 0),
    events: CONVERSATION,
    arrange: ({ link }) => Ref.set(link.commandAnswer, Exit.fail(new HerdrUnavailable())),
    settle: () => clicks(STOP),
  }),
  chatStory({
    slug: 'stop-failed-then-turn-ends',
    title: 'Composer, a refused Stop, gone once the turn is over',
    shows: { selector: '[role="alert"]' },
    ends: { absent: REFUSED_SEND },
    row: chatAgent('working', 0),
    events: CONVERSATION,
    arrange: ({ link }) => Ref.set(link.commandAnswer, Exit.fail(new HerdrUnavailable())),
    settle: () => clicks(STOP),
    timeline: [
      step<LinkStage>(800, 'The turn ends on its own', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgent('idle', 0)))),
      ),
    ],
  }),
  chatStory({
    slug: 'sent',
    title: 'Composer, Sent bubble until the transcript holds it',
    events: CONVERSATION,
    arrange: (stage) => delivered(stage, DRAFT),
    settle: () => Effect.andThen(typesDraft(DRAFT), clicks(SEND)),
    shows: { text: 'Sent' },
  }),
  chatStory({
    slug: 'queued',
    title: 'Composer, a prompt queued while Claude works',
    row: chatAgent('working', 0),
    events: CONVERSATION,
    arrange: (stage) => delivered(stage, DRAFT),
    settle: () => Effect.andThen(typesDraft(DRAFT), clicks(SEND)),
    shows: { text: 'Queued' },
  }),
  chatStory({
    slug: 'send-failed',
    title: 'Composer, a send that failed',
    events: CONVERSATION,
    arrange: ({ link }) => Ref.set(link.commandAnswer, Exit.fail(new HerdrUnavailable())),
    settle: () => Effect.andThen(typesDraft(DRAFT), clicks(SEND)),
    shows: { selector: '[role="alert"]' },
  }),
  chatStory({
    slug: 'open-quiet-redial',
    title: 'Composer, open during a quiet redial',
    link: stateWith(REDIALING, Option.some(chatHerd())),
    events: CONVERSATION,
    shows: { selector: 'textarea[placeholder="Message Claude"]' },
  }),
  chatStory({
    slug: 'paused-unreachable',
    title: 'Composer, paused while the hub is unreachable',
    link: stateWith(UNREACHABLE, Option.some(chatHerd())),
    events: CONVERSATION,
    shows: { selector: 'textarea[placeholder="Sending is paused until crook reconnects"]' },
  }),
  chatStory({
    slug: 'slash-list',
    title: 'Slash commands, the list under /',
    events: [opened(), chunk(0, 10, [said(0, 'Ready.')]), caughtUp(10), SKILLS],
    settle: () => typesDraft('/'),
    shows: { text: 'This project' },
  }),
  chatStory({
    slug: 'slash-filtered',
    title: 'Slash commands, filtered as you type',
    events: [opened(), chunk(0, 10, [said(0, 'Ready.')]), caughtUp(10), SKILLS],
    settle: () => typesDraft('/com'),
    shows: { text: '/compact' },
  }),
  chatStory({
    slug: 'slash-builtin-only',
    title: 'Slash commands, no session skills yet',
    events: CONVERSATION,
    settle: () => typesDraft('/'),
    shows: { text: 'Claude Code' },
  }),
  chatStory({
    slug: 'slash-chosen',
    title: 'Slash commands, one chosen into the field',
    shows: { field: '/handoff ' },
    events: [opened(), chunk(0, 10, [said(0, 'Ready.')]), caughtUp(10), SKILLS],
    settle: () => Effect.andThen(typesDraft('/'), clicks('/handoff')),
  }),
  chatStory({
    slug: 'slash-sent',
    title: 'Slash commands, Sent until the transcript answers',
    shows: { all: [{ text: 'Sent' }, { text: '/model opus' }] },
    events: CONVERSATION,
    arrange: (stage) => delivered(stage, '/model opus'),
    settle: () => Effect.andThen(typesDraft('/model opus'), clicks(SEND)),
  }),
  chatStory({
    slug: 'slash-queued',
    title: 'Slash commands, Queued while Claude works',
    shows: { all: [{ text: 'Queued' }, { text: '/effort high' }] },
    row: chatAgent('working', 0),
    events: CONVERSATION,
    arrange: (stage) => delivered(stage, '/effort high'),
    settle: () => Effect.andThen(typesDraft('/effort high'), clicks(SEND)),
  }),
  chatStory({
    slug: 'slash-refused',
    title: 'Slash commands, a bare picker refused because it needs the laptop',
    shows: { all: [{ text: 'needs the laptop' }, { field: '/model' }] },
    events: CONVERSATION,
    settle: () => Effect.andThen(typesDraft('/model'), clicks(SEND)),
  }),
  chatStory({
    slug: 'slash-refused-resume',
    title: 'Slash commands, a bare /resume refused with what would work',
    shows: { all: [{ text: 'Name a session instead' }, { field: '/resume' }] },
    events: CONVERSATION,
    settle: () => Effect.andThen(typesDraft('/resume'), clicks(SEND)),
  }),
  chatStory({
    slug: 'claude-waiting',
    title: 'Composer, a send refused while Claude waits on the laptop, its draft kept',
    shows: { all: [{ text: CLAUDE_WAITING_NOTE }, { field: DRAFT }] },
    row: chatAgentSaying(true),
    events: CONVERSATION,
    settle: () => Effect.andThen(typesDraft(DRAFT), clicks(SEND)),
  }),
  chatStory({
    slug: 'claude-waiting-ends',
    title: 'Composer, a refused send that goes once the dialog closes on the laptop',
    shows: { all: [{ text: CLAUDE_WAITING_NOTE }, { field: DRAFT }] },
    ends: { all: [{ absent: CLAUDE_WAITING_NOTE }, { text: 'Sent' }] },
    row: chatAgentSaying(true),
    events: CONVERSATION,
    arrange: (stage) => delivered(stage, DRAFT),
    settle: () => Effect.andThen(typesDraft(DRAFT), clicks(SEND)),
    timeline: [
      step<LinkStage>(800, 'The dialog closes on the laptop', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgentSaying(false)))),
      ),
      step<LinkStage>(800, 'The user sends again', () => clicks(SEND)),
    ],
  }),
  chatStory({
    slug: 'claude-waiting-refused-by-agent',
    title: 'Composer, the agent refuses a send the phone had not yet heard it should hold',
    shows: { all: [{ selector: '[role="alert"]' }, { text: CLAUDE_WAITING_NOTE }] },
    events: CONVERSATION,
    arrange: ({ link }) => Ref.set(link.commandAnswer, Exit.fail(claudeWaitingRefusal())),
    settle: () => Effect.andThen(typesDraft(DRAFT), clicks(SEND)),
  }),
  chatStory({
    slug: 'prompts-sent-and-queued',
    title: 'Composer, Sent then Queued rows stacked',
    events: opensWith([prompt(0, 'first')]),
    arrange: (stage) => delivered(stage, 'second'),
    settle: ({ link }) =>
      Effect.gen(function* () {
        yield* seesText('first')
        yield* typesDraft('second')
        yield* clicks(SEND)
        yield* SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgent('working'))))
        yield* typesDraft('third')
        yield* clicks(SEND)
      }),
    shows: { text: 'Queued' },
  }),
  chatStory({
    slug: 'queued-landed',
    title: 'Composer, a queued prompt in the transcript',
    events: opensWith([user(0, [new TextBlock({ text: 'Queued earlier' })], { queued: true })]),
    shows: { text: 'Queued earlier' },
  }),
]
