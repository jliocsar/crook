export const SECTIONS_LABEL = 'Sections'
export const SCREEN_TITLE_ATTRIBUTE = 'data-screen-title'

export const focusScreenTitle = (screen: HTMLElement | null): void => {
  screen?.querySelector<HTMLElement>(`[${SCREEN_TITLE_ATTRIBUTE}]`)?.focus({ preventScroll: true })
}

export const restoreFocus = (opener: Element | null): void => {
  const target =
    opener instanceof HTMLElement && opener.isConnected && opener !== document.body
      ? opener
      : document.querySelector<HTMLElement>(
          `nav[aria-label="${SECTIONS_LABEL}"] [aria-current="page"]`,
        )
  target?.focus({ preventScroll: true })
}
