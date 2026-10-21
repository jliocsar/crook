import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { parseLine } from '@crook/claude/TranscriptParser'
import { TranscriptOffset } from '@crook/domain/Ids'
import { MalformedLine, UnrecognizedEntry } from '@crook/domain/TranscriptMessage'

import { encodeMessages, fixtureText, messagesOf, services } from './Fixtures'

const LINE = TranscriptOffset.make(711)

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

layer(services, { excludeTestServices: true })('parseLine on real transcript lines', (live) => {
  live.effect(
    'keeps the prompt, the reply and the turn end of a plain turn, and drops metadata',
    () =>
      Effect.gen(function* () {
        expect(yield* messagesOf('plain-turn.jsonl')).toEqual([
          {
            _tag: 'User',
            offset: 800,
            uuid: 'b1d1b34a-10f0-4471-98ef-c604be264ab0',
            timestamp: '2026-10-20T17:52:35.958Z',
            isMeta: false,
            origin: 'human',
            queued: false,
            blocks: [{ _tag: 'Text', text: 'Reply with exactly the word pong and nothing else.' }],
          },
          {
            _tag: 'Assistant',
            offset: 20016,
            uuid: 'd902aae0-0e88-4c1a-9dac-e6e0da005a1f',
            timestamp: '2026-10-20T17:52:39.863Z',
            apiMessageId: 'msg_011CgDv3WRgi9fKeFdsAUB1j',
            model: 'claude-sonnet-5-5',
            stopReason: 'end_turn',
            isApiError: false,
            blocks: [{ _tag: 'Text', text: 'pong' }],
          },
          {
            _tag: 'System',
            offset: 36050,
            uuid: 'aa7d13a0-8c4d-4b22-8055-1880e76d0e77',
            timestamp: '2026-10-20T17:52:40.081Z',
            blocks: [{ _tag: 'TurnDuration', durationMs: 4263 }],
          },
        ])
      }),
  )

  live.effect('pairs tool calls with their results, with the Edit patch from toolUseResult', () =>
    Effect.gen(function* () {
      const messages = yield* messagesOf('tool-use-and-result.jsonl')

      expect(messages).toHaveLength(9)
      expect(messages[3]).toMatchObject({
        _tag: 'Assistant',
        blocks: [
          {
            _tag: 'ToolUse',
            id: 'toolu_01SpWWngLEUQyyfebjcyE5iK',
            name: 'Edit',
            input: { old_string: 'hello', new_string: 'hello world' },
          },
        ],
      })
      expect(messages[4]).toMatchObject({
        _tag: 'User',
        origin: null,
        blocks: [
          {
            _tag: 'ToolResult',
            toolUseId: 'toolu_01SpWWngLEUQyyfebjcyE5iK',
            isError: false,
            patch: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                lines: ['-hello', '+hello world'],
              },
            ],
            subagent: null,
          },
        ],
      })
      expect(messages[2]).toMatchObject({ blocks: [{ _tag: 'ToolResult', patch: null }] })
    }),
  )

  live.effect('reads every tool_result content shape, errors and interrupts', () =>
    Effect.gen(function* () {
      const messages = yield* messagesOf('tool-result-variants.jsonl')

      expect(messages[1]).toMatchObject({
        blocks: [
          {
            _tag: 'ToolResult',
            content: [
              { _tag: 'ToolReference', toolName: 'mcp__lx__list_sources' },
              { _tag: 'ToolReference', toolName: 'mcp__lx__search_docs' },
              { _tag: 'ToolReference', toolName: 'mcp__lx__fetch_doc' },
              { _tag: 'ToolReference', toolName: 'WebSearch' },
            ],
          },
        ],
      })
      expect(messages[2]).toMatchObject({ blocks: [{ _tag: 'ToolResult', isError: true }] })
      expect(messages[3]).toMatchObject({
        blocks: [{ _tag: 'Interruption', text: '[Request interrupted by user for tool use]' }],
      })
      expect(messages[6]).toMatchObject({
        blocks: [
          {
            _tag: 'ToolResult',
            content: [{ _tag: 'Text' }],
            subagent: { subagent: 'a2a36d68f3fc86124', status: 'async_launched' },
          },
        ],
      })
    }),
  )

  live.effect('reads images in both shapes, once each, from tool results and pasted prompts', () =>
    Effect.gen(function* () {
      const image = { _tag: 'Image', mediaType: 'image/png' }
      const messages = yield* messagesOf('image.jsonl')

      expect(messages[1]).toMatchObject({
        blocks: [{ _tag: 'ToolResult', content: [image] }],
      })
      expect(messages[2]).toMatchObject({
        origin: 'human',
        blocks: [
          { _tag: 'Text', text: 'ok look: [Image #1] [Image #2] [Image #3]' },
          image,
          image,
          image,
        ],
      })
      expect(messages[6]).toMatchObject({
        blocks: [{ _tag: 'ToolResult', content: [{ _tag: 'Text', text: 'B here' }, image] }],
      })
      expect(messages[8]).toMatchObject({
        blocks: [{ _tag: 'ToolResult', content: [{ _tag: 'Text', text: 'C here' }, image] }],
      })
    }),
  )

  live.effect('keeps an image of a type nobody measured out of the image blocks', () =>
    Effect.gen(function* () {
      const svgPaste = {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/svg+xml', data: 'PHN2Zz4=' },
            },
          ],
        },
      }

      expect(encodeMessages(parseLine(encodeJson(svgPaste), LINE))).toMatchObject([
        { _tag: 'User', blocks: [{ _tag: 'Unrecognized', kind: 'image' }] },
      ])
    }),
  )

  live.effect('keeps thinking blocks whose text is empty', () =>
    Effect.gen(function* () {
      const messages = yield* messagesOf('thinking.jsonl')

      expect(messages).toMatchObject([
        { blocks: [{ _tag: 'Thinking', text: '' }] },
        { blocks: [{ _tag: 'Thinking' }] },
        { blocks: [{ _tag: 'Thinking', text: '' }] },
      ])
    }),
  )

  live.effect('turns /compact into a boundary, a summary and the command it ran', () =>
    Effect.gen(function* () {
      expect(yield* messagesOf('compaction-manual.jsonl')).toMatchObject([
        { _tag: 'User', blocks: [{ _tag: 'Text', text: '/compact' }] },
        {
          _tag: 'System',
          blocks: [
            {
              _tag: 'CompactBoundary',
              trigger: 'manual',
              tokensBefore: 37963,
              tokensAfter: 5477,
            },
          ],
        },
        { _tag: 'User', blocks: [{ _tag: 'CompactSummary' }] },
        { _tag: 'User', isMeta: true, blocks: [{ _tag: 'Text' }] },
        { _tag: 'User', blocks: [{ _tag: 'LocalCommand', name: '/compact', args: '' }] },
        {
          _tag: 'User',
          blocks: [{ _tag: 'LocalCommandOutput', text: 'Compacted (ctrl+o to see full summary)' }],
        },
        {
          _tag: 'User',
          origin: 'human',
          blocks: [{ _tag: 'Text', text: 'Reply with exactly the word after and nothing else.' }],
        },
      ])
      expect(yield* messagesOf('compaction-auto.jsonl')).toMatchObject([
        { blocks: [{ _tag: 'CompactBoundary', trigger: 'auto' }] },
        { blocks: [{ _tag: 'CompactSummary' }] },
      ])
    }),
  )

  live.effect('opens a cleared session with the /clear command and drops its empty output', () =>
    Effect.gen(function* () {
      const messages = yield* messagesOf('clear-new-session.jsonl')

      expect(messages).toHaveLength(5)
      expect(messages[0]).toMatchObject({ _tag: 'User', isMeta: true })
      expect(messages[1]).toMatchObject({
        blocks: [{ _tag: 'LocalCommand', name: '/clear', args: '' }],
      })
    }),
  )

  live.effect('reads task notifications as subagent status, not as prompts', () =>
    Effect.gen(function* () {
      const messages = yield* messagesOf('subagent/ff0f77be-1e98-4bb2-8b24-38d673361867.jsonl')

      expect(messages[5]).toMatchObject({
        blocks: [
          {
            _tag: 'ToolResult',
            subagent: { subagent: 'a370777a87a436836', status: 'async_launched' },
          },
        ],
      })
      expect(messages[9]).toMatchObject({
        _tag: 'User',
        origin: 'task-notification',
        blocks: [
          {
            _tag: 'TaskNotification',
            taskId: 'a370777a87a436836',
            toolUseId: 'toolu_01W5pW7EVJbSou9dL9TCPQPx',
          },
        ],
      })
    }),
  )

  live.effect('drops every known non-chat entry and flags the API error', () =>
    Effect.gen(function* () {
      const messages = yield* messagesOf('odd-entries.jsonl')

      expect(messages).toMatchObject([
        { _tag: 'Assistant', isApiError: true, model: '<synthetic>' },
        { _tag: 'System', blocks: [{ _tag: 'CompactBoundary', trigger: 'manual' }] },
        {
          _tag: 'System',
          blocks: [
            {
              _tag: 'Notice',
              text: 'codemode: reloaded (4 hooks: session.start, tool.call, tool.describe, prompt.attachment)',
            },
          ],
        },
        {
          _tag: 'System',
          blocks: [{ _tag: 'Notice', text: 'Running scheduled task (Oct 6 11:47pm)' }],
        },
        { _tag: 'System', blocks: [{ _tag: 'TurnDuration', durationMs: 85736 }] },
      ])
    }),
  )

  live.effect('names entries and blocks it does not know instead of dropping them', () =>
    Effect.gen(function* () {
      expect(yield* messagesOf('unknown-future-entry.jsonl')).toMatchObject([
        { _tag: 'UnrecognizedEntry', offset: 0, entryType: 'some-future-type' },
        { _tag: 'Assistant', blocks: [{ _tag: 'Unrecognized', kind: 'some_future_block' }] },
      ])
    }),
  )

  live.effect(
    'recovers the record glued after a torn one, keeping the torn bytes as malformed',
    () =>
      Effect.gen(function* () {
        const torn = (yield* fixtureText('torn-mid-file.jsonl')).split('\n')[1] ?? ''
        const recovered = torn.slice(torn.indexOf('{"parentUuid"', 1))
        const user = recovered.replace('"type": "attachment"', '"type": "future-attachment"')

        expect(yield* messagesOf('torn-mid-file.jsonl')).toEqual([
          { _tag: 'Malformed', offset: 711, byteLength: 259 },
        ])
        expect(encodeMessages(parseLine(torn.replace(recovered, user), LINE))).toEqual([
          { _tag: 'Malformed', offset: 711, byteLength: 259 },
          { _tag: 'UnrecognizedEntry', offset: 970, entryType: 'future-attachment' },
        ])
      }),
  )

  live.effect('reports a line that never completes as malformed when asked to parse it', () =>
    Effect.gen(function* () {
      const truncated = (yield* fixtureText('truncated-final-line.jsonl')).split('\n')[2] ?? ''

      expect(parseLine(truncated, LINE)).toEqual([
        new MalformedLine({ offset: LINE, byteLength: new TextEncoder().encode(truncated).length }),
      ])
      expect(parseLine('{"type": 42}', LINE)).toEqual([
        new UnrecognizedEntry({ offset: LINE, entryType: 'unknown' }),
      ])
    }),
  )
})
