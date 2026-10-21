import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

export interface ServiceManagerCall {
  readonly program: string
  readonly args: readonly string[]
}

const SUCCESS_EXIT_CODE = 0

export const systemctl = (...args: readonly string[]): ServiceManagerCall => ({
  program: 'systemctl',
  args: ['--user', ...args],
})

export const launchctl = (...args: readonly string[]): ServiceManagerCall => ({
  program: 'launchctl',
  args,
})

export const commandLine = (call: ServiceManagerCall) => [call.program, ...call.args].join(' ')

export class ServiceManagerRefused extends Schema.TaggedError<ServiceManagerRefused>()(
  'ServiceManagerRefused',
  { command: Schema.String, exitCode: Schema.Int, detail: Schema.String },
) {
  override get message(): string {
    return `"${this.command}" exited with ${this.exitCode}: ${this.detail || 'it printed no reason'}. Read what it says, fix that, and run the same crook-agent command again.`
  }
}

export class ServiceManagerNotRun extends Schema.TaggedError<ServiceManagerNotRun>()(
  'ServiceManagerNotRun',
  { command: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Could not run "${this.command}": ${this.detail}. crook-agent manages its service through systemd on Linux and launchd on macOS; check that this user can run that command.`
  }
}

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  const outcomeOf = Effect.fn('ServiceManager.outcomeOf')(function* (call: ServiceManagerCall) {
    const handle = yield* spawner.spawn(ChildProcess.make(call.program, call.args))
    const [detail, , exitCode] = yield* Effect.all(
      [
        Stream.mkString(Stream.decodeText(handle.stderr)),
        Stream.runDrain(handle.stdout),
        handle.exitCode,
      ],
      { concurrency: 'unbounded' },
    )

    return { detail: detail.trim(), exitCode }
  }, Effect.scoped)

  const run = Effect.fn('ServiceManager.run')(function* (call: ServiceManagerCall) {
    const command = commandLine(call)
    const { detail, exitCode } = yield* outcomeOf(call).pipe(
      Effect.catchTag('PlatformError', (error) =>
        Effect.fail(new ServiceManagerNotRun({ command, detail: error.message })),
      ),
    )

    return yield* exitCode === SUCCESS_EXIT_CODE
      ? Effect.void
      : Effect.fail(new ServiceManagerRefused({ command, exitCode, detail }))
  })

  return ServiceManager.of({ run })
})

export class ServiceManager extends Context.Service<
  ServiceManager,
  {
    readonly run: (
      call: ServiceManagerCall,
    ) => Effect.Effect<void, ServiceManagerRefused | ServiceManagerNotRun>
  }
>()('@crook/agent/ServiceManager') {
  static readonly layer = Layer.effect(this, make)

  static readonly layerTest = (
    calls: Queue.Queue<ServiceManagerCall>,
    answer: (call: ServiceManagerCall) => Effect.Effect<void, ServiceManagerRefused> = () =>
      Effect.void,
  ) =>
    Layer.succeed(
      this,
      ServiceManager.of({
        run: (call) => Queue.offer(calls, call).pipe(Effect.andThen(answer(call))),
      }),
    )
}
