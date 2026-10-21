import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'
import * as ChildProcess from 'effect/process/ChildProcess'
import { ChildProcessSpawner } from 'effect/process/ChildProcessSpawner'

import {
  type Artifact,
  type ReleaseTarget,
  artifactName,
  artifactsFor,
  bunCompileTarget,
} from '@crook/release/Targets'
import { PackageVersion, releasedVersion } from '@crook/release/ReleaseVersion'
import { WEB_BUILD_DIRECTORY } from '@crook/web/build/WebBuild'

export interface Workspace {
  readonly root: string
  readonly output: string
}

const OUTPUT_DIRECTORY = 'dist'
const SUCCESS = 0

export class WebBuildFailed extends Schema.TaggedError<WebBuildFailed>()('WebBuildFailed', {
  exitCode: Schema.Int,
}) {
  override get message(): string {
    return `The web build exited with ${this.exitCode}, so there is nothing for the hub to embed. Its output is above; \`bun run --filter @crook/web build\` reproduces it.`
  }
}

export class CompileFailed extends Schema.TaggedError<CompileFailed>()('CompileFailed', {
  artifact: Schema.String,
  exitCode: Schema.Int,
}) {
  override get message(): string {
    return `bun build --compile exited with ${this.exitCode} while building ${this.artifact}. Its output is above.`
  }
}

const webBuildOf = (workspace: Workspace) => `${workspace.root}/packages/web/${WEB_BUILD_DIRECTORY}`

const embeddedAssets = (artifact: Artifact, workspace: Workspace): readonly string[] =>
  Match.value(artifact.app).pipe(
    Match.when('hub', () => [`--asset=${webBuildOf(workspace)}`]),
    Match.when('agent', () => []),
    Match.exhaustive,
  )

export const compileArguments = (artifact: Artifact, workspace: Workspace): readonly string[] => [
  'build',
  '--compile',
  '--no-compile-autoload-dotenv',
  '--no-compile-autoload-bunfig',
  `--target=${bunCompileTarget(artifact.target)}`,
  `--outfile=${workspace.output}/${artifactName(artifact)}`,
  ...embeddedAssets(artifact, workspace),
  `${workspace.root}/packages/${artifact.app}/src/main.ts`,
]

export const thisWorkspace = Effect.gen(function* () {
  const path = yield* Path.Path
  const root = path.resolve(import.meta.dirname, '..', '..', '..')

  return { root, output: path.join(root, OUTPUT_DIRECTORY) }
})

const exitCodeOf = Effect.fn('Build.exitCodeOf')(function* (command: ChildProcess.Command) {
  const spawner = yield* ChildProcessSpawner

  return yield* spawner.exitCode(command)
})

const buildWeb = (workspace: Workspace) =>
  exitCodeOf(
    ChildProcess.make('bun', ['run', 'build'], {
      cwd: `${workspace.root}/packages/web`,
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  ).pipe(
    Effect.filterOrFail(
      (exitCode) => exitCode === SUCCESS,
      (exitCode) => new WebBuildFailed({ exitCode }),
    ),
  )

const compile = Effect.fn('Build.compile')(function* (artifact: Artifact, workspace: Workspace) {
  const fileSystem = yield* FileSystem.FileSystem
  const outfile = `${workspace.output}/${artifactName(artifact)}`

  yield* fileSystem.remove(outfile, { force: true })
  yield* exitCodeOf(
    ChildProcess.make('bun', compileArguments(artifact, workspace), {
      cwd: workspace.root,
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  ).pipe(
    Effect.filterOrFail(
      (exitCode) => exitCode === SUCCESS,
      (exitCode) => new CompileFailed({ artifact: artifactName(artifact), exitCode }),
    ),
  )
  yield* Effect.logInfo(`Built ${outfile}`)
})

export const build = Effect.fn('Build.build')(function* (targets: readonly ReleaseTarget[]) {
  const fileSystem = yield* FileSystem.FileSystem
  const workspace = yield* thisWorkspace

  yield* buildWeb(workspace)
  yield* fileSystem.makeDirectory(workspace.output, { recursive: true })
  yield* Effect.forEach(artifactsFor(targets), (artifact) => compile(artifact, workspace), {
    discard: true,
  })
})

export const versionOfMember = Effect.fn('Build.versionOfMember')(function* (
  workspace: Workspace,
  member: string,
) {
  const fileSystem = yield* FileSystem.FileSystem
  const manifest = yield* fileSystem.readFileString(
    `${workspace.root}/packages/${member}/package.json`,
  )
  const { version } = yield* Schema.decodeEffect(PackageVersion)(manifest)

  return version
})

export const checkVersion = Effect.fn('Build.checkVersion')(function* (tag: string) {
  const workspace = yield* thisWorkspace
  const agent = yield* versionOfMember(workspace, 'agent')
  const hub = yield* versionOfMember(workspace, 'hub')
  const version = yield* releasedVersion(tag, { agent, hub })

  yield* Effect.logInfo(`Releasing ${version}: the agent and the hub are both at it.`)
})
