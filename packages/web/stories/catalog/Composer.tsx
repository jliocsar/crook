import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { SkillListing } from '@crook/domain/Skill'
import { SkillsChanged } from '@crook/domain/Transcript'
import { HerdrUnavailable } from '@crook/protocol/Commands'
import { LinkStatus, QUIET_DIALING } from '@crook/web/rpc/HubLinkState'

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
import { chatHerd, chatStory, delivered, opensWith } from '../ChatFixtures.ts'
import { chatAgent, CONVERSATION } from '../Fixtures.ts'
import { clicks, seesText, types } from '../StageDom.ts'
import type { StoryMaker } from '../Story.tsx'

const FIELD = /Message|Reply|Sending is paused|Tell Claude/u
const SEND = 'Send'
const STOP = 'Stop (Esc)'
const TEXTAREA = 'textarea'
const DRAFT = 'Now check the toast too'

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

export const COMPOSER_STORIES: readonly StoryMaker[] = [
  chatStory({
    slug: 'ready',
    title: 'Composer, ready',
    events: CONVERSATION,
    shows: { selector: TEXTAREA },
  }),
  chatStory({
    slug: 'draft',
    title: 'Composer, a draft typed',
    events: CONVERSATION,
    settle: () => typesDraft(DRAFT),
  }),
  chatStory({
    slug: 'draft-long',
    title: 'Composer, a draft that grows the field',
    events: CONVERSATION,
    settle: () =>
      typesDraft(
        'A long draft that wraps over several lines, because the phone is narrow and the thought is not, and it keeps on going past where the field stops growing, so the field has to scroll inside itself by the end of it.',
      ),
  }),
  chatStory({
    slug: 'working',
    title: 'Composer, Stop while Claude works',
    row: chatAgent('working'),
    events: CONVERSATION,
    shows: { selector: `button[aria-label="${STOP}"]` },
  }),
  chatStory({
    slug: 'working-with-draft',
    title: 'Composer, a draft typed while Claude works',
    row: chatAgent('working'),
    events: CONVERSATION,
    settle: () => typesDraft(DRAFT),
  }),
  chatStory({
    slug: 'stopping',
    title: 'Composer, Stop pressed',
    row: chatAgent('working'),
    events: CONVERSATION,
    arrange: ({ link }) =>
      Effect.andThen(
        Ref.set(link.commandAnswer, Exit.fail(new HerdrUnavailable())),
        link.commandAnswers.close,
      ),
    settle: () => clicks(STOP),
  }),
  chatStory({
    slug: 'sending',
    title: 'Composer, Sending',
    events: CONVERSATION,
    arrange: (stage) => Effect.andThen(delivered(stage, DRAFT), stage.link.commandAnswers.close),
    settle: () => Effect.andThen(typesDraft(DRAFT), clicks(SEND)),
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
    row: chatAgent('working'),
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
    slug: 'paused-quiet',
    title: 'Composer, paused during a quiet redial',
    link: stateWith(QUIET_DIALING, Option.some(chatHerd())),
    events: CONVERSATION,
    shows: { selector: 'textarea[placeholder="Sending is paused until crook reconnects"]' },
  }),
  chatStory({
    slug: 'paused-unreachable',
    title: 'Composer, paused while the hub is unreachable',
    link: stateWith(LinkStatus.Unreachable(), Option.some(chatHerd())),
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
    events: [opened(), chunk(0, 10, [said(0, 'Ready.')]), caughtUp(10), SKILLS],
    settle: () => Effect.andThen(typesDraft('/'), clicks('/handoff')),
  }),
  chatStory({
    slug: 'slash-sent-no-bubble',
    title: 'Slash commands, sent with no Sent bubble',
    events: CONVERSATION,
    arrange: (stage) => delivered(stage, '/compact'),
    settle: () => Effect.andThen(typesDraft('/compact'), clicks(SEND)),
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
