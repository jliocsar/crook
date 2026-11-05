const othersShown = (v: any, session: string) =>
  Object.values(v.view.lines as Record<string, Record<string, string>>).some(
    (line) => line[1] === 'line' && line[2] !== session,
  )

const sessionOf = (v: any): string | undefined =>
  typeof v.view.position === 'object' && v.view.position !== null ? v.view.position.s : undefined

export const title = 'What the phone shows of a pane transcript'

export const state = (v: any) => {
  const session = sessionOf(v)

  if (v.mode === 'offline') return 'Hub out of reach, the chat dims what it has'
  if (v.mode === 'failed') return 'The watch failed, Try again is showing'
  if (session === undefined) return 'Opening, nothing to show yet'

  const above = othersShown(v, session) ? ', old lines above' : ''

  return v.view.catching
    ? `Catching up on session ${session}${above}`
    : `Live on session ${session}${above}`
}

export const group = (v: any) =>
  v.mode === 'offline' || v.mode === 'failed'
    ? 'away'
    : v.view.catching
      ? 'catching'
      : 'live'

export const colors = { away: 'tan', catching: 'yellow', live: 'teal' }

export const step = (action: string) => {
  switch (action) {
    case 'ClaudeWrites':
      return 'Claude writes a line'
    case 'PaneChangesSession':
      return 'you run /clear or /resume'
    case 'PaneLosesClaude':
    case 'PaneGetsClaudeBack':
      return 'the pane loses or regains Claude'
    case 'AgentConnectionDrops':
      return "the agent's connection drops"
    case 'PhoneConnectionDrops':
      return "the phone's connection drops"
    case 'PhoneReconnects':
      return 'the phone reconnects and resumes'
    case 'ChatReopens':
      return 'you close and reopen the chat'
    case 'UserPressesTryAgain':
      return 'you press Try again'
    case 'PhoneSeesFailure':
      return 'the agent reports the follow failed'
    case 'PhoneApplies':
      return 'the next update reaches the phone'
    default:
      return 'the pipe moves on'
  }
}