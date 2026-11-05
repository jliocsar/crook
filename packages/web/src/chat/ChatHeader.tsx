import { cn } from 'cn'
import * as Option from 'effect/Option'
import { AnimatePresence, motion } from 'motion/react'

import { ChatStatus } from '@crook/web/chat/ChatModel'
import { RunDot } from '@crook/web/components/ui/subagent-tree'
import { StatusDot } from '@crook/web/components/StatusDot'
import { STATUS_WORD } from '@crook/web/components/StatusWord'
import { Swap } from '@crook/web/components/Swap'
import { Spinner } from '@crook/web/components/ui/spinner'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { translate, useTransformString } from '@crook/web/motion/TransformString'

const PILL_RISE = 8
const PILL_SPINNER_SIZE = 14
const CATCHING_UP = 'Catching up'

const HEADER_PILL =
  'border-border bg-muted/60 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold tabular-nums'

const usePillMotion = () => {
  const transform = useTransformString()

  return {
    initial: { opacity: 0, transform: transform.translate('Y', PILL_RISE) },
    animate: { opacity: 1, transform: translate('Y', 0) },
    exit: motionTokens().exit,
    transition: motionTokens().fade,
  }
}

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

export function CatchingUpPill({ shown }: { shown: boolean }) {
  const pillMotion = usePillMotion()

  return (
    <>
      <span role="status" className="sr-only">
        {shown ? CATCHING_UP : ''}
      </span>
      <AnimatePresence initial={false}>
        {shown ? (
          <motion.span
            key="catching-up"
            aria-hidden="true"
            data-slot="catching-up-pill"
            className={cn(HEADER_PILL, 'text-muted-foreground')}
            {...pillMotion}
          >
            <Spinner alreadyWaited size={PILL_SPINNER_SIZE} />
            {CATCHING_UP}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export function RunningPill({ count, onShow }: { count: number; onShow: () => void }) {
  const pillMotion = usePillMotion()

  return (
    <AnimatePresence initial={false}>
      {count > 0 ? (
        <motion.button
          key="running"
          type="button"
          data-slot="running-pill"
          className={cn(
            HEADER_PILL,
            'text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          )}
          {...pillMotion}
          onClick={onShow}
        >
          <RunDot status="running" />
          {`${count} running`}
        </motion.button>
      ) : null}
    </AnimatePresence>
  )
}
