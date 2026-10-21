import { describe, expect, it } from '@effect/vitest'

import { EXE_DEV_PATHS } from '@crook/web/connection/ExeDevPaths'
import { loginUrl } from '@crook/web/connection/Login'

describe('loginUrl', () => {
  it('sends the user through exe.dev and back to where they were', () => {
    const login = loginUrl(new URL('https://my-hub.exe.xyz/m/laptop/p/w1:p1?from=herd'))

    expect(login.origin).toBe('https://my-hub.exe.xyz')
    expect(login.pathname).toBe('/__exe.dev/login')
    expect(login.searchParams.get('redirect')).toBe('/m/laptop/p/w1:p1?from=herd')
  })

  it('is a path the service worker leaves to the proxy', () => {
    expect(EXE_DEV_PATHS.test(loginUrl(new URL('https://my-hub.exe.xyz/')).pathname)).toBe(true)
    expect(EXE_DEV_PATHS.test('/m/laptop')).toBe(false)
  })
})
