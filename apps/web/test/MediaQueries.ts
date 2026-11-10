import { vi } from 'vitest'

const realMatchMedia = window.matchMedia.bind(window)

export const stubMediaQueries = (matching: readonly string[]): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    Object.defineProperty(realMatchMedia(query), 'matches', { value: matching.includes(query) }),
  )
}
