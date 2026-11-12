import * as Schema from 'effect/Schema'

export const AGENT_PATH = '/rpc/agent'
export const CLIENT_PATH = '/rpc/client'
export const HEALTH_PATH = '/health'
export const UPLOADS_PATH = '/uploads'
export const UPLOAD_MACHINE_PARAMETER = 'machine'
export const DIAL_REASON_PARAMETER = 'dial'
export const SERVICE_WORKER_PATH = '/ServiceWorker.js'

export const DialReason = Schema.Literals([
  'PageLoaded',
  'PageShown',
  'NetworkBack',
  'ResyncAsked',
  'PingTimedOut',
  'SocketClosed',
  'DialFailed',
  'LinkFailed',
])
export type DialReason = typeof DialReason.Type

export const LinkLoss = DialReason.pick([
  'PingTimedOut',
  'SocketClosed',
  'DialFailed',
  'LinkFailed',
])
export type LinkLoss = typeof LinkLoss.Type
