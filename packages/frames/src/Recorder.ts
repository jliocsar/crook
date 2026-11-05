import {
  CHROME_SELECTOR,
  COVER_SELECTOR,
  isContentMark,
  MARKS,
  ROW_SELECTOR,
  SCREEN_SELECTOR,
  STAGE_SELECTOR,
} from '@crook/frames/Marks'
import type { MarkDefinition } from '@crook/frames/Marks'

interface SeenElement {
  readonly box: { x: number; y: number; width: number; height: number }
  readonly opacity: number
}

interface LayoutShiftSource {
  readonly node?: Node | null
  readonly previousRect: DOMRectReadOnly
  readonly currentRect: DOMRectReadOnly
}

interface LayoutShift extends PerformanceEntry {
  readonly value: number
  readonly hadRecentInput: boolean
  readonly sources?: readonly LayoutShiftSource[]
}

const GRAPHIC_TAGS = new Set(['svg', 'img', 'canvas', 'video'])
const SR_ONLY_SIZE = 1

const round = (value: number): number => Math.round(value * 10) / 10

const nameOf = (node: Node): string => {
  if (!(node instanceof Element)) {
    return '#text'
  }

  const slot = node.getAttribute('data-slot')

  return slot === null ? node.tagName.toLowerCase() : `${node.tagName.toLowerCase()}[${slot}]`
}

const pathOf = (element: Element): string => {
  const named = element.closest('[data-slot]')

  return named === null || named === element
    ? nameOf(element)
    : `${nameOf(named)} ${nameOf(element)}`
}

const roundedBox = (rect: DOMRectReadOnly) => ({
  x: round(rect.x),
  y: round(rect.y),
  width: round(rect.width),
  height: round(rect.height),
})

const isCoveredBy = (element: Element, box: SeenElement['box'], cover: Element): boolean => {
  if (
    cover.contains(element) ||
    (cover.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) === 0
  ) {
    return false
  }

  const rect = cover.getBoundingClientRect()

  return (
    rect.left <= box.x &&
    rect.top <= box.y &&
    rect.right >= box.x + box.width &&
    rect.bottom >= box.y + box.height
  )
}

const clipToAncestors = (element: Element): SeenElement | undefined => {
  const own = element.getBoundingClientRect()
  let left = Math.max(own.left, 0)
  let top = Math.max(own.top, 0)
  let right = Math.min(own.right, window.innerWidth)
  let bottom = Math.min(own.bottom, window.innerHeight)
  let opacity = 1

  for (
    let current: Element | null = element;
    current !== null && right > left && bottom > top;
    current = current.parentElement
  ) {
    const style = getComputedStyle(current)

    opacity *= Number(style.opacity)

    if (opacity === 0 || style.visibility === 'hidden') {
      return undefined
    }

    if (current !== element && style.overflow !== 'visible') {
      const clip = current.getBoundingClientRect()

      left = Math.max(left, clip.left)
      top = Math.max(top, clip.top)
      right = Math.min(right, clip.right)
      bottom = Math.min(bottom, clip.bottom)
    }
  }

  return right - left > SR_ONLY_SIZE && bottom - top > SR_ONLY_SIZE
    ? { box: { x: left, y: top, width: right - left, height: bottom - top }, opacity }
    : undefined
}

const seenElement = (element: Element, covers: readonly Element[]): SeenElement | undefined => {
  if (!element.checkVisibility()) {
    return undefined
  }

  const seen = clipToAncestors(element)

  return seen === undefined || covers.some((cover) => isCoveredBy(element, seen.box, cover))
    ? undefined
    : seen
}

const readMark = (definition: MarkDefinition, covers: readonly Element[]) => {
  for (const element of document.querySelectorAll(definition.selector)) {
    if (definition.text === undefined || (element.textContent ?? '').includes(definition.text)) {
      const seen = seenElement(element, covers)

      if (seen !== undefined) {
        return {
          x: round(seen.box.x),
          y: round(seen.box.y),
          width: round(seen.box.width),
          height: round(seen.box.height),
          opacity: Math.round(seen.opacity * 100) / 100,
        }
      }
    }
  }

  return undefined
}

const showsContent = (stage: Element, covers: readonly Element[]): boolean => {
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!(node instanceof Element)) {
        return (node.nodeValue ?? '').trim() === ''
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT
      }

      if (node.matches(CHROME_SELECTOR)) {
        return NodeFilter.FILTER_REJECT
      }

      if (GRAPHIC_TAGS.has(node.tagName.toLowerCase())) {
        return NodeFilter.FILTER_ACCEPT
      }

      return node.matches(SCREEN_SELECTOR) && seenElement(node, covers) === undefined
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_SKIP
    },
  })

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const element = node instanceof Element ? node : node.parentElement

    if (element !== null && seenElement(element, covers) !== undefined) {
      return true
    }
  }

  return false
}

const isLayoutShift = (entry: PerformanceEntry): entry is LayoutShift =>
  entry.entryType === 'layout-shift'

const shiftedName = (node: Node | null | undefined): string => {
  if (node === null || node === undefined) {
    return 'removed'
  }

  return node instanceof Element ? pathOf(node) : nameOf(node)
}

const describeShiftSource = (source: LayoutShiftSource) => ({
  element: shiftedName(source.node),
  from: roundedBox(source.previousRect),
  to: roundedBox(source.currentRect),
})

const install = (): void => {
  const frames: unknown[] = []
  const shifts: unknown[] = []
  let added: string[] = []
  let removed: string[] = []
  let frameNumber = 0

  const collect = (records: readonly MutationRecord[]): void => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          added.push(nameOf(node))
        }
      }

      for (const node of record.removedNodes) {
        if (node instanceof Element) {
          removed.push(nameOf(node))
        }
      }
    }
  }

  const mutations = new MutationObserver(collect)

  mutations.observe(document, { childList: true, subtree: true })

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries().filter(isLayoutShift)) {
      shifts.push({
        at: round(entry.startTime),
        value: entry.value,
        hadRecentInput: entry.hadRecentInput,
        sources: (entry.sources ?? []).map(describeShiftSource),
      })
    }
  }).observe({ type: 'layout-shift', buffered: true })

  const onFrame = (vsync: number): void => {
    const started = performance.now()

    collect(mutations.takeRecords())

    const stage = document.querySelector(STAGE_SELECTOR)
    const mounted = stage !== null && stage.childElementCount > 0
    const covers = Array.from(document.querySelectorAll(COVER_SELECTOR))
    const readings = mounted
      ? MARKS.flatMap((definition) => {
          const reading = readMark(definition, covers)

          return reading === undefined ? [] : [[definition.mark, reading] as const]
        })
      : []
    const hasContentMark = readings.some(([mark]) => isContentMark(mark))

    frames.push({
      frame: frameNumber,
      at: round(started),
      vsync: round(vsync),
      phase: document.documentElement.dataset['storyPhase'] ?? '',
      mounted,
      blank: mounted && !hasContentMark && !showsContent(stage, covers),
      rows: mounted ? document.querySelectorAll(ROW_SELECTOR).length : 0,
      marks: Object.fromEntries(readings),
      added,
      removed,
      readMs: round(performance.now() - started),
    })
    added = []
    removed = []
    frameNumber += 1
    requestAnimationFrame(onFrame)
  }

  requestAnimationFrame(onFrame)

  Object.assign(window, {
    __frames: {
      read: () =>
        JSON.stringify({
          timeOrigin: performance.timeOrigin,
          frames,
          shifts,
        }),
    },
  })
}

install()
