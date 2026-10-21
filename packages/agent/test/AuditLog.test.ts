import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunPath from '@effect/platform-bun/BunPath'
import { expect, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { AuditLine, AuditLog, CrookAuditLogPath, CrookAuditPolicy } from '@crook/agent/AuditLog'
import { OWNER_ONLY_FILE_MODE } from '@crook/agent/StateDirectory'
import {
  AuditPolicy,
  DEFAULT_AUDIT_ARGUMENT_LIMIT,
  REDACTED,
  REDACT_NOTHING,
} from '@crook/domain/Audit'
import { ClosePane, Prompt } from '@crook/domain/Command'
import { IdempotencyKey, PaneId } from '@crook/domain/Ids'
import { PaneNotCreatedByCrook } from '@crook/protocol/Commands'

const PANE = PaneId.make('w1:p1')
const ACTION = IdempotencyKey.make('3f1c8a52-0b7e-4d0a-9a51-6f3f0d2f8e11')
const PERMISSION_BITS = 0o777

const auditLogAt = Effect.fn('auditLogAt')(function* (file: string) {
  const context = yield* Layer.build(
    AuditLog.layer.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            CROOK_AUDIT_LOG_PATH: file,
            CROOK_AUDIT_REDACT: 'text',
            CROOK_MACHINE_ID: 'laptop',
          }),
        ),
      ),
    ),
  )

  return Context.get(context, AuditLog)
})

layer(Layer.mergeAll(BunFileSystem.layer, BunPath.layer), { excludeTestServices: true })(
  'AuditLog',
  (it) => {
    it.effect('appends one JSON line per command to a file only its owner can read', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const file = `${yield* fileSystem.makeTempDirectoryScoped()}/state/crook/audit.jsonl`
        const audit = yield* auditLogAt(file)

        yield* audit.record(ACTION, new Prompt({ pane: PANE, text: 'deploy it' }), Exit.void)
        yield* audit.record(
          ACTION,
          new ClosePane({ pane: PANE, confirmed: false }),
          Exit.fail(new PaneNotCreatedByCrook({ pane: PANE })),
        )
        const lines = (yield* fileSystem.readFileString(file)).trimEnd().split('\n')
        const entries = lines.map((line) => Schema.decodeSync(AuditLine)(line))
        const info = yield* fileSystem.stat(file)

        expect(
          entries.map((entry) => [
            entry.machine,
            entry.key,
            entry.operation,
            entry.arguments,
            entry.outcome,
            entry.failure,
          ]),
        ).toEqual([
          [
            'laptop',
            ACTION,
            'Prompt',
            { pane: 'w1:p1', text: REDACTED },
            'succeeded',
            Option.none(),
          ],
          [
            'laptop',
            ACTION,
            'ClosePane',
            { pane: 'w1:p1', confirmed: false },
            'failed',
            Option.some('PaneNotCreatedByCrook'),
          ],
        ])
        expect(info.mode & PERMISSION_BITS).toBe(OWNER_ONLY_FILE_MODE)
      }),
    )

    it.effect('reads its path and policy from the environment, with decided defaults', () =>
      Effect.gen(function* () {
        const environment = ConfigProvider.fromUnknown({ HOME: '/home/jc' })

        expect(yield* CrookAuditLogPath.parse(environment)).toBe(
          '/home/jc/.local/state/crook/audit.jsonl',
        )
        expect(yield* CrookAuditPolicy.parse(environment)).toEqual(
          new AuditPolicy({ argumentLimit: DEFAULT_AUDIT_ARGUMENT_LIMIT, redactedArguments: [] }),
        )
        expect(
          yield* CrookAuditPolicy.parse(
            ConfigProvider.fromUnknown({
              CROOK_AUDIT_ARGUMENT_LIMIT: '80',
              CROOK_AUDIT_REDACT: 'text,label',
            }),
          ),
        ).toEqual(new AuditPolicy({ argumentLimit: 80, redactedArguments: ['text', 'label'] }))
      }),
    )

    it.effect('fails at startup on a redaction it cannot honour rather than logging the data', () =>
      Effect.gen(function* () {
        const policyFrom = (redact: string) =>
          CrookAuditPolicy.parse(ConfigProvider.fromUnknown({ CROOK_AUDIT_REDACT: redact }))
        const nothing = yield* policyFrom(REDACT_NOTHING)
        const misspelt = yield* Effect.exit(policyFrom('txt'))
        const padded = yield* Effect.exit(policyFrom('text, keys'))

        expect(nothing.redactedArguments).toEqual([])
        expect(Exit.isFailure(misspelt)).toBe(true)
        expect(Exit.isFailure(padded)).toBe(true)
      }),
    )

    it.effect('ignores a state home that is not an absolute path, as the XDG spec says', () =>
      Effect.gen(function* () {
        const pathWith = (stateHome: string) =>
          CrookAuditLogPath.parse(
            ConfigProvider.fromUnknown({ HOME: '/home/jc', XDG_STATE_HOME: stateHome }),
          )

        expect(yield* pathWith('/var/state')).toBe('/var/state/crook/audit.jsonl')
        expect(yield* pathWith('')).toBe('/home/jc/.local/state/crook/audit.jsonl')
        expect(yield* pathWith('state')).toBe('/home/jc/.local/state/crook/audit.jsonl')
      }),
    )
  },
)
