import { EXE_DEV_LOGIN_PATH } from '@crook/web/connection/ExeDevPaths'

const REDIRECT_PARAMETER = 'redirect'

export const loginUrl = (page: URL): URL => {
  const login = new URL(EXE_DEV_LOGIN_PATH, page)

  login.searchParams.set(REDIRECT_PARAMETER, `${page.pathname}${page.search}`)

  return login
}

export const logInAgain = (): void => {
  window.location.assign(loginUrl(new URL(window.location.href)))
}
