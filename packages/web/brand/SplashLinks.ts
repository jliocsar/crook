const LIGHT_SPLASH_LINK =
  /(<link rel="apple-touch-startup-image" media=")(?![^"]*prefers-color-scheme)([^"]*)("[^>]*apple-splash-[a-z]+-light-)/gu

const SCREEN_PREFIX = 'screen and '

const scopeToLight = (media: string): string =>
  media.startsWith(SCREEN_PREFIX)
    ? `${SCREEN_PREFIX}(prefers-color-scheme: light) and ${media.slice(SCREEN_PREFIX.length)}`
    : `(prefers-color-scheme: light) and ${media}`

export const scopeLightSplashLinks = (html: string): string =>
  html.replaceAll(
    LIGHT_SPLASH_LINK,
    (_link, opening: string, media: string, rest: string) =>
      `${opening}${scopeToLight(media)}${rest}`,
  )
