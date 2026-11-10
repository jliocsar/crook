import './RenderCounter.ts'

import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

import indexCss from '@crook/web/index.css?raw'

const FIND_LIMIT_MS = 3000
const MOTION_TOKEN = /^\s*(--(?:motion|ease)[a-z-]*):\s*([^;]+);/gmu

configure({ asyncUtilTimeout: FIND_LIMIT_MS })

Reflect.deleteProperty(Element.prototype, 'animate')

for (const [, property = '', value = ''] of indexCss.matchAll(MOTION_TOKEN)) {
  document.documentElement.style.setProperty(property, value)
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})
