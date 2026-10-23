import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { CrookVersion } from '@crook/domain/CrookVersion'

interface WorkspaceVersions {
  readonly agent: string
  readonly hub: string
}

const TAG_PREFIX = 'v'

export const PackageVersion = Schema.fromJsonString(Schema.Struct({ version: Schema.String }))

export class TagNotAVersion extends Schema.TaggedError<TagNotAVersion>()('TagNotAVersion', {
  tag: Schema.String,
}) {
  override get message(): string {
    return `The tag ${this.tag} is not a release tag. A release tag is a v followed by a plain major.minor.patch version, such as v0.1.0.`
  }
}

export class VersionMismatch extends Schema.TaggedError<VersionMismatch>()('VersionMismatch', {
  tagged: CrookVersion,
  agent: Schema.String,
  hub: Schema.String,
}) {
  override get message(): string {
    return `The tag releases ${this.tagged}, but @crook/agent is at ${this.agent} and @crook/hub at ${this.hub}. The agent and the hub release under one version: set both package.json versions to ${this.tagged}, commit, and tag that commit.`
  }
}

const versionOfTag = (tag: string) =>
  Effect.fromOption(
    pipe(
      Option.liftPredicate(tag, Str.startsWith(TAG_PREFIX)),
      Option.map(Str.slice(TAG_PREFIX.length)),
      Option.flatMap(Schema.decodeUnknownOption(CrookVersion)),
    ),
    () => new TagNotAVersion({ tag }),
  )

export const releasedVersion = Effect.fn('ReleaseVersion.releasedVersion')(function* (
  tag: string,
  versions: WorkspaceVersions,
) {
  return yield* versionOfTag(tag).pipe(
    Effect.filterOrFail(
      (tagged) => versions.agent === tagged && versions.hub === tagged,
      (tagged) => new VersionMismatch({ tagged, ...versions }),
    ),
  )
})
