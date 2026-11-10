import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as React from 'react'

import { STORIES } from './Catalog.ts'
import type { PlayerSnapshot, StoryApi } from './Player.ts'
import type { Story } from './Story.tsx'

const STORY_PARAM = 'story'
const AUTOPLAY_PARAM = 'autoplay'
const PHONE_WIDTH = 390
const PHONE_HEIGHT = 844
const STORY_ONLY_CLASS = 'outline-[#c0ffee]'

const urlParams = () => new URLSearchParams(window.location.search)

const frameUrl = (id: string, autoplay: boolean): string =>
  `/stories/frame.html?${STORY_PARAM}=${encodeURIComponent(id)}${autoplay ? `&${AUTOPLAY_PARAM}=1` : ''}`

const groupsOf = (stories: readonly Story[]): readonly (readonly [string, readonly Story[]])[] =>
  pipe(
    stories,
    Arr.map((story) => story.group),
    Arr.dedupe,
    Arr.map((group) => [group, Arr.filter(stories, (story) => story.group === group)] as const),
  )

const matches = (story: Story, query: string): boolean =>
  story.id.includes(query.toLowerCase()) || story.title.toLowerCase().includes(query.toLowerCase())

const usePlayer = (frame: React.RefObject<HTMLIFrameElement | null>, frameKey: string) => {
  const [api, setApi] = React.useState(Option.none<StoryApi>())
  const [snapshot, setSnapshot] = React.useState(Option.none<PlayerSnapshot>())

  React.useEffect(() => {
    setApi(Option.none())
    setSnapshot(Option.none())

    const element = frame.current

    if (element === null) {
      return undefined
    }

    let unsubscribe = () => {}

    const onLoad = () => {
      const { __story: story } = element.contentWindow ?? {}
      const found = Option.fromNullishOr(story)

      setApi(found)
      unsubscribe = Option.match(found, {
        onNone: () => () => {},
        onSome: (player) =>
          player.subscribe((next) => {
            setSnapshot(Option.some(next))
          }),
      })
    }

    element.addEventListener('load', onLoad)

    return () => {
      element.removeEventListener('load', onLoad)
      unsubscribe()
    }
  }, [frame, frameKey])

  return { api, snapshot }
}

function Sidebar({
  selected,
  query,
  onQuery,
  onSelect,
}: {
  selected: string
  query: string
  onQuery: (query: string) => void
  onSelect: (id: string) => void
}) {
  const shown = Arr.filter(STORIES, (story) => matches(story, query))

  return (
    <nav
      aria-label="Stories"
      className="border-border bg-card flex h-dvh w-72 shrink-0 flex-col border-r"
    >
      <div className="border-border border-b p-3">
        <p className="font-display text-lg font-bold">crook stories</p>
        <p className="text-muted-foreground text-xs">
          {shown.length} of {STORIES.length}
        </p>
        <input
          aria-label="Filter stories"
          value={query}
          onChange={(event) => {
            onQuery(event.target.value)
          }}
          placeholder="Filter"
          className="border-input bg-background mt-2 w-full rounded-md border px-2 py-1 text-sm"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groupsOf(shown).map(([group, stories]) => (
          <section key={group} className="mb-3">
            <h2 className="text-muted-foreground px-2 py-1 text-xs font-semibold uppercase">
              {group} ({stories.length})
            </h2>
            <ul>
              {stories.map((story) => (
                <li key={story.id}>
                  <button
                    type="button"
                    aria-current={story.id === selected ? 'true' : undefined}
                    onClick={() => {
                      onSelect(story.id)
                    }}
                    className={`w-full rounded-md px-2 py-1 text-left text-sm ${
                      story.id === selected ? 'bg-accent text-accent-foreground' : ''
                    }`}
                  >
                    {story.kind === 'transition' ? `▸ ${story.title}` : story.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  )
}

function Controls({
  story,
  api,
  snapshot,
}: {
  story: Story
  api: Option.Option<StoryApi>
  snapshot: Option.Option<PlayerSnapshot>
}) {
  const act = (run: (player: StoryApi) => Promise<void>) => () => {
    Option.map(api, (player) => {
      void run(player)
    })
  }
  const position = Option.match(snapshot, { onNone: () => 0, onSome: (now) => now.position })
  const phase = Option.match(snapshot, { onNone: () => 'loading', onSome: (now) => now.phase })
  const failure = Option.flatMap(snapshot, (now) => Option.fromNullishOr(now.failure))

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 p-3 text-sm">
      <div>
        <p className="font-semibold">{story.title}</p>
        <p className="text-muted-foreground font-mono text-xs break-all">{story.id}</p>
        <p className="text-muted-foreground font-mono text-xs break-all">{story.path}</p>
      </div>
      {Option.match(story.note, {
        onNone: () => null,
        onSome: (note) => <p className="text-muted-foreground text-xs">{note}</p>,
      })}
      <p data-slot="story-phase" className="font-mono text-xs">
        {phase}
      </p>
      {Option.match(failure, {
        onNone: () => null,
        onSome: (message) => <p className="text-destructive text-xs">{message}</p>,
      })}
      <div className="flex flex-wrap gap-1">
        {story.kind === 'transition' ? (
          <>
            <ControlButton label="Play" onClick={act((player) => player.play())} />
            <ControlButton label="Pause" onClick={act((player) => player.pause())} />
            <ControlButton label="Step" onClick={act((player) => player.step())} />
          </>
        ) : null}
        <ControlButton label="Replay" onClick={act((player) => player.replay())} />
        <a
          href={frameUrl(story.id, false)}
          target="_blank"
          rel="noreferrer"
          className="border-border rounded-md border px-2 py-1"
        >
          Bare
        </a>
      </div>
      {story.kind === 'transition' ? (
        <ol className="grid gap-1">
          {story.steps.map((info, index) => (
            <li
              key={`${index} ${info.label}`}
              data-done={index < position}
              data-next={index === position}
              className="data-[next=true]:bg-accent rounded-md px-2 py-1 data-[done=true]:opacity-50"
            >
              <span className="text-muted-foreground font-mono text-xs">+{info.delayMs} ms </span>
              {info.label}
            </li>
          ))}
        </ol>
      ) : null}
    </aside>
  )
}

function ControlButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border bg-background rounded-md border px-2 py-1"
    >
      {label}
    </button>
  )
}

export function CatalogShell() {
  const [selected, setSelected] = React.useState(
    () => urlParams().get(STORY_PARAM) ?? STORIES[0]?.id ?? '',
  )
  const [autoplay, setAutoplay] = React.useState(() => urlParams().has(AUTOPLAY_PARAM))
  const [query, setQuery] = React.useState('')
  const frame = React.useRef<HTMLIFrameElement>(null)
  const { api, snapshot } = usePlayer(frame, selected)
  const story = Arr.findFirst(STORIES, (found) => found.id === selected)

  const select = (id: string) => {
    setSelected(id)
    setAutoplay(false)
    window.history.replaceState(null, '', `?${STORY_PARAM}=${encodeURIComponent(id)}`)
  }

  return (
    <div className={`flex h-dvh overflow-hidden ${STORY_ONLY_CLASS}`}>
      <Sidebar selected={selected} query={query} onQuery={setQuery} onSelect={select} />
      <main className="bg-muted/40 flex min-w-0 flex-1 justify-center overflow-auto p-4 max-lg:justify-start">
        <iframe
          key={selected}
          ref={frame}
          title="Story"
          src={frameUrl(selected, autoplay)}
          style={{ width: PHONE_WIDTH, height: PHONE_HEIGHT }}
          className="border-border bg-background shrink-0 rounded-2xl border"
        />
      </main>
      {Option.match(story, {
        onNone: () => null,
        onSome: (found) => <Controls story={found} api={api} snapshot={snapshot} />,
      })}
    </div>
  )
}
