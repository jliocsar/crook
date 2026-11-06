import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

const MCP_TOOL = /^mcp__(?<server>.+?)__(?<name>.+)$/u
const PLUGIN_SERVER = /^plugin_.+_(?<server>[^_]+)$/u
const CODE_MODE_NAME = 'code mode'

export const CODE_MODE_TOOL = 'mcp__codemode__run'

const spoken = (identifier: string): string => identifier.replaceAll(/_+/gu, ' ')

const serverName = (server: string): string =>
  spoken(PLUGIN_SERVER.exec(server)?.groups?.['server'] ?? server)

const mcpToolName = (tool: string): string =>
  pipe(
    Option.fromNullishOr(MCP_TOOL.exec(tool)?.groups),
    Option.match({
      onNone: () => tool,
      onSome: ({ server = '', name = '' }) => `${spoken(name)} from ${serverName(server)}`,
    }),
  )

export const toolName = (tool: string): string =>
  tool === CODE_MODE_TOOL ? CODE_MODE_NAME : mcpToolName(tool)
