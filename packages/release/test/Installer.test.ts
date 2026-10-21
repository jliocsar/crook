import * as BunServices from '@effect/platform-bun/BunServices'
import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/process/ChildProcess'

import { artifactName, hostTarget } from '@crook/release/Targets'

interface Sandbox {
  readonly root: string
  readonly release: string
  readonly installed: string
  readonly cosignCalls: string
  readonly ghCalls: string
}

interface Release {
  readonly agentReports: string
  readonly checksumOf: (agent: string) => string
  readonly cosignExit: number
}

const INSTALLER = `${import.meta.dirname}/../install.sh`
const VERSION = '0.2.0'
const SYSTEM_PATH = '/usr/bin:/bin'
const SIGNED_BY = `https://github.com/jliocsar/crook/.github/workflows/release.yml@refs/tags/v${VERSION}`
const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com'
const EXECUTABLE = 0o755

const FAKE_GH = `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_CALLS"
if [ "$1 $2" = 'release view' ]; then
  printf 'v${VERSION}\\n'
  exit 0
fi
while [ $# -gt 0 ]; do
  case "$1" in
    --pattern) pattern="$2"; shift 2 ;;
    --dir) directory="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cp "$FAKE_RELEASE/$pattern" "$directory/$pattern"
`

const fakeCosign = (exitCode: number) => `#!/bin/sh
printf '%s\\n' "$*" >> "$COSIGN_CALLS"
exit ${exitCode}
`

const fakeAgent = (reports: string) => `#!/bin/sh
printf '%s\\n' '${reports}'
`

const honestRelease: Release = {
  agentReports: `crook-agent v${VERSION}`,
  checksumOf: (agent) => agent,
  cosignExit: 0,
}

const sha256Of = (contents: string) => new Bun.CryptoHasher('sha256').update(contents).digest('hex')

const sandboxWith = Effect.fn('sandboxWith')(function* (release: Release) {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()
  const target = yield* hostTarget(process.platform, process.arch)
  const agentArtifact = artifactName({ app: 'agent', target })
  const agent = fakeAgent(release.agentReports)
  const sandbox: Sandbox = {
    root,
    release: `${root}/release`,
    installed: `${root}/bin`,
    cosignCalls: `${root}/cosign-calls`,
    ghCalls: `${root}/gh-calls`,
  }

  yield* fileSystem.makeDirectory(sandbox.release)
  yield* fileSystem.makeDirectory(`${root}/fakes`)
  yield* fileSystem.writeFileString(`${sandbox.release}/${agentArtifact}`, agent)
  yield* fileSystem.writeFileString(
    `${sandbox.release}/SHA256SUMS`,
    `${sha256Of(release.checksumOf(agent))}  ${agentArtifact}\n`,
  )
  yield* fileSystem.writeFileString(`${sandbox.release}/SHA256SUMS.sigstore.json`, '{}')
  yield* fileSystem.writeFileString(`${root}/fakes/gh`, FAKE_GH)
  yield* fileSystem.writeFileString(`${root}/fakes/cosign`, fakeCosign(release.cosignExit))
  yield* fileSystem.chmod(`${root}/fakes/gh`, EXECUTABLE)
  yield* fileSystem.chmod(`${root}/fakes/cosign`, EXECUTABLE)

  return sandbox
})

const install = Effect.fn('install')(function* (sandbox: Sandbox, args: readonly string[]) {
  const handle = yield* ChildProcess.make('sh', [INSTALLER, ...args], {
    cwd: sandbox.root,
    env: {
      PATH: `${sandbox.root}/fakes:${SYSTEM_PATH}`,
      HOME: sandbox.root,
      TMPDIR: sandbox.root,
      CROOK_INSTALL_DIR: sandbox.installed,
      CROOK_COSIGN: `${sandbox.root}/fakes/cosign`,
      FAKE_RELEASE: sandbox.release,
      GH_CALLS: sandbox.ghCalls,
      COSIGN_CALLS: sandbox.cosignCalls,
    },
  })
  const output = yield* handle.all.pipe(Stream.decodeText(), Stream.mkString)
  const exitCode = yield* handle.exitCode

  return { exitCode, output }
})

const installedAgent = Effect.fn('installedAgent')(function* (sandbox: Sandbox) {
  const fileSystem = yield* FileSystem.FileSystem

  return yield* fileSystem.exists(`${sandbox.installed}/crook-agent`)
})

layer(BunServices.layer)('install.sh', (it) => {
  it.effect('installs the latest agent once its signature and checksum check out', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const sandbox = yield* sandboxWith(honestRelease)
      const result = yield* install(sandbox, [])
      const cosignCalls = yield* fileSystem.readFileString(sandbox.cosignCalls)
      const ghCalls = yield* fileSystem.readFileString(sandbox.ghCalls)
      const installed = yield* fileSystem.readFileString(`${sandbox.installed}/crook-agent`)

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(`installed ${sandbox.installed}/crook-agent ${VERSION}`)
      expect(cosignCalls).toContain(`--certificate-identity ${SIGNED_BY}`)
      expect(cosignCalls).toContain(`--certificate-oidc-issuer ${GITHUB_ISSUER}`)
      expect(ghCalls).toContain(`release download v${VERSION} --repo jliocsar/crook`)
      expect(installed).toBe(fakeAgent(honestRelease.agentReports))
    }),
  )

  it.effect('installs nothing when the checksums are not signed by the release workflow', () =>
    Effect.gen(function* () {
      const sandbox = yield* sandboxWith({ ...honestRelease, cosignExit: 1 })
      const result = yield* install(sandbox, ['--version', VERSION])

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain(
        `the checksums of v${VERSION} are not signed by the release workflow of jliocsar/crook`,
      )
      expect(yield* installedAgent(sandbox)).toBe(false)
    }),
  )

  it.effect('installs nothing when the binary does not match its signed checksum', () =>
    Effect.gen(function* () {
      const sandbox = yield* sandboxWith({ ...honestRelease, checksumOf: () => 'another build' })
      const result = yield* install(sandbox, ['--version', VERSION])

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('does not match its signed checksum')
      expect(yield* installedAgent(sandbox)).toBe(false)
    }),
  )

  it.effect('installs nothing when the binary reports another version than the release', () =>
    Effect.gen(function* () {
      const sandbox = yield* sandboxWith({ ...honestRelease, agentReports: 'crook-agent v0.1.0' })
      const result = yield* install(sandbox, ['--version', VERSION])

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('reports "crook-agent v0.1.0" rather than crook-agent v0.2.0')
      expect(yield* installedAgent(sandbox)).toBe(false)
    }),
  )

  it.effect('refuses a version that is not a plain major.minor.patch before downloading', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const sandbox = yield* sandboxWith(honestRelease)
      const result = yield* install(sandbox, ['--version', '0.2.0-rc.1'])

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('0.2.0-rc.1 is not a crook version')
      expect(yield* fileSystem.exists(sandbox.ghCalls)).toBe(false)
    }),
  )
})
