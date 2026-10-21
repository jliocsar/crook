export const SECTIONS_LABEL = 'Sections'
export const SCREEN_TITLE_ATTRIBUTE = 'data-screen-title'

export const focusScreenTitle = (screen: HTMLElement | null): void => {
  screen?.querySelector<HTMLElement>(`[${SCREEN_TITLE_ATTRIBUTE}]`)?.focus({ preventScroll: true })
}

export const focusTarget = (opener: Element | null): HTMLElement | null =>
  opener instanceof HTMLElement &&
  opener.isConnected &&
  opener !== document.body &&
  opener.closest('[inert]') === null
    ? opener
    : document.querySelector<HTMLElement>(
        `nav[aria-label="${SECTIONS_LABEL}"] [aria-current="page"]`,
      )

export const restoreFocus = (opener: Element | null): void => {
  focusTarget(opener)?.focus({ preventScroll: true })
}
