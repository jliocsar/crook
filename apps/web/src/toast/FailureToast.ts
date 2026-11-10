import { useAtomSet } from '@effect/atom-react/Hooks'
import * as Option from 'effect/Option'
import * as React from 'react'

import { ToastIntent, toastAtom } from '@crook/web/atoms/Toast'

export const useFailureToast = (failure: Option.Option<string>): void => {
  const show = useAtomSet(toastAtom)
  const message = Option.getOrUndefined(failure)
  const alreadyShown = React.useRef(message)

  React.useEffect(() => {
    if (message !== undefined && message !== alreadyShown.current) {
      show(ToastIntent.Show({ text: message }))
    }

    alreadyShown.current = message
  }, [message])
}
