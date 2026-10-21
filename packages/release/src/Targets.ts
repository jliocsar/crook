import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Schema from 'effect/Schema'

export interface Artifact {
  readonly app: ReleaseApp
  readonly target: ReleaseTarget
}

export const ReleaseTarget = Schema.Literals(['linux-x64', 'linux-arm64', 'darwin-arm64'])
export type ReleaseTarget = typeof ReleaseTarget.Type

export const ReleaseApp = Schema.Literals(['agent', 'hub'])
export type ReleaseApp = typeof ReleaseApp.Type

export class HostNotReleased extends Schema.TaggedError<HostNotReleased>()('HostNotReleased', {
  host: Schema.String,
}) {
  override get message(): string {
    return `crook releases no build for this machine (${this.host}): the release targets are ${ReleaseTarget.literals.join(', ')}. Pass one of them with --target instead of --host.`
  }
}

export const bunCompileTarget = (target: ReleaseTarget) => `bun-${target}` as const

export const artifactName = ({ app, target }: Artifact) => `crook-${app}-${target}` as const

export const hostTarget = (platform: string, architecture: string) => {
  const host = `${platform}-${architecture}`

  return Schema.decodeUnknownEffect(ReleaseTarget)(host).pipe(
    Effect.mapError(() => new HostNotReleased({ host })),
  )
}

export const artifactsFor = (targets: readonly ReleaseTarget[]): readonly Artifact[] =>
  pipe(
    Arr.dedupe(targets),
    Arr.flatMap((target) => Arr.map(ReleaseApp.literals, (app) => ({ app, target }))),
  )
