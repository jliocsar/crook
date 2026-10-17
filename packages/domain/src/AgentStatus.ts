import * as Schema from 'effect/Schema'

export const AgentStatus = Schema.Literals(['idle', 'working', 'blocked', 'done', 'unknown'])
export type AgentStatus = typeof AgentStatus.Type
