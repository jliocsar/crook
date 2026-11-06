import * as Option from 'effect/Option'

import { ChatStatus } from '@crook/web/chat/ChatModel'
import { StatusDot } from '@crook/web/components/StatusDot'
import { STATUS_WORD } from '@crook/web/components/StatusWord'
import { Swap } from '@crook/web/components/Swap'

function HollowDot() {
  return (
    <span
      aria-hidden="true"
      data-slot="hollow-dot"
      className="border-muted-foreground inline-block size-2 shrink-0 rounded-full border"
    />
  )
}

export function ChatStatusLine({
  status,
  place,
}: {
  status: ChatStatus
  place: Option.Option<string>
}) {
  const word = ChatStatus.$match(status, {
    Agent: (agent) => STATUS_WORD[agent.status],
    Ended: (ended) => ended.label,
    Quiet: () => '',
  })

  return (
    <>
      {ChatStatus.$match(status, {
        Agent: (agent) => <StatusDot status={agent.status} />,
        Ended: () => <HollowDot />,
        Quiet: () => null,
      })}
      <span role="status" className={word === '' ? 'sr-only' : 'inline-flex'}>
        {word === '' ? null : (
          <Swap id={word} className="text-foreground font-semibold">
            {word}
          </Swap>
        )}
      </span>
      {Option.match(place, {
        onNone: () => null,
        onSome: (text) => (
          <>
            {word === '' ? null : <span aria-hidden="true">·</span>}
            <span className="truncate font-mono">{text}</span>
          </>
        ),
      })}
    </>
  )
}
