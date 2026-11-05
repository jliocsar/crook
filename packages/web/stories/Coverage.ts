import type { ToolCallStatus } from '@crook/web/components/ui/tool-call'
import type { Ask, AskedAction } from '@crook/domain/Ask'
import type { AskAnswerState } from '@crook/web/chat/AskModel'
import type { JobKind, JobState } from '@crook/web/chat/BackgroundModel'
import type { ChatItem } from '@crook/web/chat/ChatItems'
import type { ChatScreenModel, ChatStatus, EdgeKind } from '@crook/web/chat/ChatModel'
import type { ConnectionNotice } from '@crook/web/connection/ConnectionView'
import type { HerdNotice } from '@crook/web/herd/HerdLayout'
import type { LinkStatus } from '@crook/web/rpc/HubLinkState'
import type { TestNotificationState } from '@crook/web/settings/SettingsLayout'

export const LINK_STATUS_MOMENTS = {
  Dialing: [
    'dialing-cold-cached',
    'dialing-cold-empty',
    'dialing-quiet',
    'dialing-announced-syncing',
    'dialing-announced-connecting',
  ],
  Live: ['live', 'live-recovered'],
  Unreachable: ['unreachable', 'unreachable-empty'],
  Offline: ['offline'],
  Expired: ['expired'],
  LoggedOut: ['logged-out'],
} as const satisfies Record<LinkStatus['_tag'], readonly string[]>

export const MOMENT_BEFORE_ANY_STATUS = 'before-first-value'

export const STATE_COVERAGE = {
  chatItem: {
    UserPrompt: ['rows/prompt', 'rows/prompt-queued', 'rows/prompt-image'],
    AssistantText: ['rows/text-markdown', 'rows/text-failed'],
    Tool: ['rows/tool-running', 'rows/tool-read-open'],
    Subagents: ['rows/subagent-tree-running'],
    Plan: ['rows/plan'],
    Note: ['rows/note-interrupted', 'rows/note-notice', 'rows/slash-local-command'],
    Compacted: ['rows/compacted', 'rows/compacted-open'],
    Cleared: ['rows/cleared', 'real/clear-across-sessions'],
    Omitted: ['chat/show-earlier', 'chat/show-earlier-pending'],
    Unreadable: ['rows/unreadable', 'real/torn-mid-file'],
  } satisfies Record<ChatItem['_tag'], readonly string[]>,
  toolStatus: {
    running: ['rows/tool-running'],
    waiting: ['rows/tool-waiting'],
    success: ['rows/tool-read'],
    error: ['rows/tool-error'],
    stopped: ['rows/tool-stopped'],
  } satisfies Record<ToolCallStatus, readonly string[]>,
  chatPresence: {
    loading: ['chat/presence-loading', 'chat/skeleton'],
    live: ['chat/conversation'],
    away: ['chat/away', 'chat/away-empty', 'chat/reconnecting'],
    exited: ['chat/exited'],
    closed: ['chat/closed'],
    notClaude: ['chat/not-claude'],
  } satisfies Record<ChatScreenModel['presence'], readonly string[]>,
  edgeCard: {
    away: ['chat/away'],
    exited: ['chat/exited'],
    closed: ['chat/closed'],
  } satisfies Record<EdgeKind, readonly string[]>,
  chatStatus: {
    Agent: ['chat/conversation'],
    Ended: ['chat/exited'],
    Quiet: ['chat/presence-loading'],
  } satisfies Record<ChatStatus['_tag'], readonly string[]>,
  connectionNotice: {
    connecting: ['link/dialing-announced-connecting/agents'],
    syncing: ['link/dialing-announced-syncing/agents'],
    unreachable: ['link/unreachable/agents'],
    offline: ['link/offline/agents'],
    recovered: ['link/live-recovered/agents'],
  } satisfies Record<ConnectionNotice, readonly string[]>,
  herdNotice: {
    noMachines: ['herd/no-machines'],
    nothingRunning: ['herd/nothing-running'],
    allOffline: ['herd/all-offline'],
  } satisfies Record<HerdNotice, readonly string[]>,
  ask: {
    PermissionAsk: ['ask/permission-command'],
    QuestionAsk: ['ask/question', 'ask/question-multi-select', 'ask/question-list'],
    UnknownAsk: ['ask/unknown'],
  } satisfies Record<Ask['_tag'], readonly string[]>,
  askedAction: {
    RunCommand: ['ask/permission-command', 'ask/permission-long-command'],
    EditFile: ['ask/permission-edit'],
    WriteFile: ['ask/permission-write'],
    UseTool: ['ask/permission-tool'],
    ScreenDetail: ['ask/permission-screen'],
  } satisfies Record<AskedAction['_tag'], readonly string[]>,
  askAnswer: {
    Open: ['ask/permission-command'],
    Answering: ['ask/answering'],
    Answered: ['ask/answered'],
    AlreadyAnswered: ['ask/already-answered'],
    Refused: ['ask/refused'],
  } satisfies Record<AskAnswerState['_tag'], readonly string[]>,
  jobState: {
    running: ['background/running'],
    done: ['background/settling'],
    failed: ['background/mixed'],
    stopped: ['background/marker-stopped'],
    unconfirmed: ['background/unconfirmed'],
  } satisfies Record<JobState, readonly string[]>,
  jobKind: {
    subagent: ['background/running'],
    shell: ['background/sheet-shell'],
    monitor: ['background/sheet-monitor'],
  } satisfies Record<JobKind, readonly string[]>,
  testNotification: {
    idle: ['settings/shown'],
    sending: ['settings/test-sending'],
    sent: ['settings/test-sent'],
  } satisfies Record<TestNotificationState, readonly string[]>,
}

export const REQUIRED_TRANSITIONS: readonly string[] = [
  'transition/cold-chat-open',
  'transition/cached-reopen-catch-up',
  'transition/reconnect-chat-open',
  'transition/machine-redial',
  'transition/clear',
  'transition/prompt-to-answer',
  'transition/herd-first-load-from-cache',
]

export const REQUIRED_SCREENS: readonly string[] = [
  'gate/install-safari',
  'gate/install-chrome',
  'gate/logged-out',
  'gate/session-expired',
  'herd/full',
  'machines/list',
  'machine/detail',
  'new-agent/starts-in-checkout',
  'settings/shown',
  'chat/conversation',
  'subagent/running',
  'herd/add-machine-sheet',
  'actions/idle',
  'settings/log-out-sheet',
  'background/sheet-shell',
  'composer/ready',
  'actions/toast-after-chat-close',
  'link/unreachable/agents',
]
