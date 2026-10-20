import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import indexCss from '@crook/web/index.css?raw'

const MOTION_TOKEN = /^\s*(--(?:motion|ease)[a-z-]*):\s*([^;]+);/gmu

Reflect.deleteProperty(Element.prototype, 'animate')

for (const [, property = '', value = ''] of indexCss.matchAll(MOTION_TOKEN)) {
  document.documentElement.style.setProperty(property, value)
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})
