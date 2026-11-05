import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { reconnectBackoff } from '@crook/protocol/AgentLink'

const WATCH_RETRY_BASE = Duration.millis(100)

export class LocalWatchFailed extends Schema.TaggedError<LocalWatchFailed>()('LocalWatchFailed', {
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Could not watch ${this.path}, so a change there waits for the next herdr event until the watch comes back. Check that crook runs as the same user as Claude and that fs.inotify.max_user_watches is not used up.`
  }
}

export const keepWatching =
  (path: string) =>
  <Failure>(watching: Effect.Effect<void, Failure>) => {
    const failed = (cause: unknown) => new LocalWatchFailed({ path, cause })

    return watching.pipe(
      Effect.forever,
      Effect.mapError(failed),
      Effect.catchDefect((defect) => Effect.fail(failed(defect))),
      Effect.tapError((error) => Effect.logWarning(error.message)),
      Effect.retry(reconnectBackoff(WATCH_RETRY_BASE)),
    )
  }
