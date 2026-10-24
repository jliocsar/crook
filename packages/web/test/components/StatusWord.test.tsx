import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusWord } from '@crook/web/components/StatusWord'

describe('StatusWord', () => {
  it('says a blocked agent needs you, the words the tab badge and the chat use', () => {
    const { container } = render(<StatusWord status="blocked" />)

    expect(container.textContent).toBe('needs you')
  })

  it('names every other status as it is', () => {
    const { container } = render(<StatusWord status="working" />)

    expect(container.textContent).toBe('working')
  })
})
