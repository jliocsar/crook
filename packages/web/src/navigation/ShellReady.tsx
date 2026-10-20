import * as React from 'react'

const ShellReadyContext = React.createContext<React.RefObject<boolean>>({ current: true })

export const useShellReady = (): React.RefObject<boolean> => React.useContext(ShellReadyContext)

export function ShellReadyProvider({ children }: { children: React.ReactNode }) {
  const ready = React.useRef(false)

  React.useEffect(() => {
    ready.current = true
  }, [])

  return <ShellReadyContext value={ready}>{children}</ShellReadyContext>
}
