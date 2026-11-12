import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Equivalence from 'effect/Equivalence'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'

import type { IdempotencyKey } from '@crook/domain/Ids'
import { sendCommandAtom } from '@crook/web/atoms/Commands'
import { draftAtom } from '@crook/web/atoms/Drafts'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { ComposerDraft, type DraftKey } from '@crook/web/cache/DraftCache'

export class SentDraft extends Data.Class<{
  readonly key: IdempotencyKey
  readonly draft: DraftKey
  readonly text: Option.Option<string>
  readonly digests: readonly string[]
}> {}

const sameDigests = Arr.makeEquivalence(Equivalence.String)

const digestsOf = (draft: ComposerDraft): readonly string[] =>
  Arr.map(draft.attachments, (attachment) => attachment.digest)

const withoutSent = (draft: ComposerDraft, sent: SentDraft): ComposerDraft => {
  const textSent = Option.exists(sent.text, (text) => text !== '' && draft.text.trim() === text)
  const attachmentsSent =
    Arr.isReadonlyArrayNonEmpty(sent.digests) && sameDigests(digestsOf(draft), sent.digests)

  return new ComposerDraft({
    text: textSent ? '' : draft.text,
    attachments: attachmentsSent ? [] : draft.attachments,
  })
}

export const clearSentDraftAtom = hubRuntime
  .fn(
    (sent: SentDraft) =>
      Effect.gen(function* () {
        const answered = yield* Effect.exit(
          Atom.getResult(sendCommandAtom(sent.key), { suspendOnWaiting: true }),
        )

        if (Exit.isSuccess(answered)) {
          yield* Atom.update(draftAtom(sent.draft), (draft) => withoutSent(draft, sent))
        }
      }),
    { concurrent: true },
  )
  .pipe(Atom.keepAlive)
