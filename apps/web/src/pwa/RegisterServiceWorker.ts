import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { SERVICE_WORKER_PATH } from '@crook/protocol/HubRoutes'

export class ServiceWorkerRegistrationFailed extends Schema.TaggedError<ServiceWorkerRegistrationFailed>()(
  'ServiceWorkerRegistrationFailed',
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return `The browser refused to register the app shell service worker at ${SERVICE_WORKER_PATH}, so crook will not open offline. Check that the hub serves ${SERVICE_WORKER_PATH} from the site root.`
  }
}

export const registerServiceWorker = Effect.gen(function* () {
  if (!import.meta.env.PROD || !window.isSecureContext) {
    return
  }

  yield* Effect.tryPromise({
    try: () => navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: '/' }),
    catch: (cause) => new ServiceWorkerRegistrationFailed({ cause }),
  }).pipe(
    Effect.catchTag('ServiceWorkerRegistrationFailed', (error) => Effect.logWarning(error.message)),
  )
}).pipe(Effect.withSpan('RegisterServiceWorker'))
