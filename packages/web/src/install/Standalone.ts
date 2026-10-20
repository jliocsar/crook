const STANDALONE_QUERY = '(display-mode: standalone)'

export const isStandalone = (): boolean =>
  window.matchMedia(STANDALONE_QUERY).matches || navigator.standalone === true

declare global {
  interface Navigator {
    readonly standalone?: boolean
  }
}
