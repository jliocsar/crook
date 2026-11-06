import type { ToolCallStatus } from '@crook/web/components/ui/tool-call'
import type { Ask, AskedAction } from '@crook/domain/Ask'
import type { AskAnswerState } from '@crook/web/chat/AskModel'
import type { ActivityState } from '@crook/web/chat/ActivityMachine'
import type { JobKind, JobState } from '@crook/web/chat/BackgroundModel'
import type { ChatItem } from '@crook/web/chat/ChatItems'
import type { ChatStatus, EdgeKind } from '@crook/web/chat/ChatModel'
import type { PresenceState } from '@crook/web/chat/PresenceMachine'
import type { TranscriptViewState } from '@crook/web/chat/TranscriptMachine'
import type { ConnectionNotice } from '@crook/web/connection/ConnectionView'
import type { HerdNotice } from '@crook/web/herd/HerdLayout'
import type { LinkStatus } from '@crook/web/rpc/HubLinkState'
import type { TestNotificationState } from '@crook/web/settings/SettingsLayout'
import type { SentWaitState } from '@crook/web/actions/SentWaitMachine'
import type { ComposerFailureState } from '@crook/web/chat/ComposerFailureMachine'
import type { IndicatorState } from '@crook/web/machine/IndicatorMachine'

export const LINK_STATUS_MOMENTS = {
  ColdStart: ['dialing-cold-cached', 'dialing-cold-empty'],
  Redialing: ['dialing-quiet'],
  Parked: ['parked'],
  Announced: ['dialing-announced-syncing', 'dialing-announced-connecting'],
  Returning: ['returning', 'returning-empty'],
  Live: ['live'],
  Recovered: ['live-recovered'],
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
    Note: ['rows/note-interrupted', 'rows/note-notice', 'rows/slash-failed', 'rows/slash-unknown'],
    Command: [
      'rows/slash-local-command',
      'rows/slash-with-args',
      'rows/slash-skill',
      'rows/slash-shell',
      'rows/slash-long-output',
      'real/slash-commands',
    ],
    Compacted: ['rows/compacted', 'rows/compacted-open'],
    Cleared: ['rows/cleared', 'real/clear-across-sessions'],
    Omitted: [
      'chat/show-earlier',
      'chat/show-earlier-pending',
      'transition/reopen-over-big-gap',
      'transition/show-earlier-at-hole',
    ],
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
    Loading: ['chat/presence-loading', 'chat/skeleton'],
    Live: ['chat/conversation'],
    Redialing: ['transition/machine-redial'],
    Reconnecting: ['chat/reconnecting', 'transition/machine-back-after-hub-restart'],
    Away: ['chat/away', 'chat/away-empty', 'transition/machine-gone'],
    Exited: ['chat/exited'],
    Closed: ['chat/closed'],
    NotClaude: ['chat/not-claude'],
  } satisfies Record<PresenceState['_tag'], readonly string[]>,
  transcriptView: {
    NoView: ['chat/skeleton', 'transition/older-agent-open'],
    Cached: ['transition/reopen-while-dialing'],
    Holding: ['transition/cached-reopen-catch-up'],
    CatchingUp: ['transition/slow-catch-up', 'chat/catching-up'],
    NoticeLeaving: ['transition/catch-up-lands-under-words'],
    LoadingEarlier: ['transition/show-earlier-loads', 'chat/show-earlier-pending'],
    Current: ['chat/conversation'],
    OpenedEmpty: ['transition/opened-empty'],
    Failed: ['chat/failed-with-lines', 'chat/failed-empty', 'transition/failed-then-retry'],
    Retrying: ['chat/retrying', 'transition/failed-then-retry'],
  } satisfies Record<TranscriptViewState['_tag'], readonly string[]>,
  edgeCard: {
    away: ['chat/away'],
    exited: ['chat/exited'],
    closed: ['chat/closed'],
  } satisfies Record<EdgeKind, readonly string[]>,
  chatActivity: {
    NoAgent: ['chat/presence-loading', 'chat/exited'],
    Still: ['chat/conversation'],
    Blocked: ['ask/permission-command'],
    Working: [
      'composer/working',
      'chat/working-then-idle-hold',
      'transition/turn-with-tools',
      'transition/idle-before-answer',
      'subagent/turn-with-tools',
    ],
    Finished: ['chat/answer-before-idle', 'transition/prompt-to-answer'],
    Away: ['chat/away'],
  } satisfies Record<ActivityState['_tag'], readonly string[]>,
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
    idle: ['settings/shown', 'settings/test-sent-clears'],
    sending: ['settings/test-sending'],
    sent: ['settings/test-sent'],
  } satisfies Record<TestNotificationState, readonly string[]>,
  indicator: {
    Hidden: ['composer/ready'],
    Delaying: ['composer/sending-quiet'],
    Holding: ['composer/sending'],
    Showing: ['composer/sending'],
    Lingering: ['composer/send-answered-past-the-delay'],
    Leaving: ['composer/send-answered-past-the-delay'],
  } satisfies Record<IndicatorState['_tag'], readonly string[]>,
  sentWait: {
    NotSent: ['actions/idle'],
    Awaiting: ['actions/rename-gives-up'],
    Unconfirmed: [
      'actions/rename-gives-up',
      'actions/close-gives-up',
      'chat/restart-gives-up',
      'new-agent/not-shown',
      'ask/answer-gives-up',
    ],
  } satisfies Record<SentWaitState['_tag'], readonly string[]>,
  composerFailure: {
    NoFailure: ['composer/ready'],
    PromptFailed: ['composer/send-failed', 'composer/send-failed-then-edited'],
    StopFailed: ['composer/stop-failed', 'composer/stop-failed-then-turn-ends'],
  } satisfies Record<ComposerFailureState['_tag'], readonly string[]>,
  herdrLink: {
    connected: ['machine/detail', 'machines/list'],
    lost: [
      'machines/herdr-lost',
      'machines/herdr-lost-update',
      'machine/herdr-lost',
      'machine/herdr-lost-update-long-name',
      'machine/herdr-lost-since-start',
    ],
    lostButOffline: ['machines/herdr-lost-offline'],
    lostThenBack: ['machines/herdr-lost-and-back', 'machine/herdr-lost-and-back'],
  },
}

export const REQUIRED_TRANSITIONS: readonly string[] = [
  'transition/cold-chat-open',
  'transition/cached-reopen-catch-up',
  'transition/reconnect-chat-open',
  'transition/machine-redial',
  'transition/machine-gone',
  'transition/machine-back-after-hub-restart',
  'transition/clear',
  'transition/resume-other-session',
  'transition/prompt-to-answer',
  'transition/turn-with-tools',
  'transition/idle-before-answer',
  'transition/compact-ends-the-turn',
  'transition/slash-send-lands',
  'transition/slash-send-silent',
  'subagent/turn-with-tools',
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
