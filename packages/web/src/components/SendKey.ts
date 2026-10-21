import type * as React from 'react'

const COARSE_POINTER = '(pointer: coarse)'

const hasSoftKeyboard = (): boolean => window.matchMedia(COARSE_POINTER).matches

export const isSendKey = (event: React.KeyboardEvent): boolean =>
  event.key === 'Enter' &&
  !event.shiftKey &&
  !event.nativeEvent.isComposing &&
  (event.metaKey || event.ctrlKey || !hasSoftKeyboard())
