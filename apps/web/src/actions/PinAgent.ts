import { useAtom } from '@effect/atom-react/Hooks'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import { failureOf, pinProgress } from '@crook/web/actions/PaneActions'
import { setPinnedAtom } from '@crook/web/atoms/AgentActions'
import type { PaneAddress } from '@crook/web/atoms/AgentActions'

export const usePinAgent = (
  agent: PaneAddress,
  { pinned, controlsEnabled }: { readonly pinned: boolean; readonly controlsEnabled: boolean },
) => {
  const [result, request] = useAtom(setPinnedAtom(agent))
  const [requested, setRequested] = React.useState(false)

  React.useEffect(() => {
    setRequested(false)
  }, [controlsEnabled])

  return {
    pending: AsyncResult.isWaiting(result),
    failure: requested ? failureOf(pinProgress(result, pinned)) : Option.none<string>(),
    toggle: () => {
      setRequested(true)
      request(!pinned)
    },
  }
}
