import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'

import { shellQuoted } from '@crook/domain/ShellQuoting'

export interface EnvironmentEntry {
  readonly name: string
  readonly value: string
}

export interface ServiceDefinitionInput {
  readonly program: readonly string[]
  readonly environmentFile: string
}

export interface LaunchdDefinitionInput extends ServiceDefinitionInput {
  readonly logFile: string
}

const INTERRUPTED_EXIT_CODE = 130
const RUN_SUBCOMMAND = 'run'
const SAFE_SHELL_WORD = /^[\w./:=@+,-]+$/u
const SERVICE_NAME = 'crook-agent'

export const SYSTEMD_UNIT_NAME = `${SERVICE_NAME}.service`
export const LAUNCHD_LABEL = SERVICE_NAME
export const LAUNCHD_ENVIRONMENT_WRAPPER = 'set -a && . "$0" && exec "$@"'

const SYSTEMD_WORD_ESCAPES = {
  '\\': '\\\\',
  '"': '\\"',
  '%': '%%',
  $: '$$',
} satisfies Record<string, string>

const SYSTEMD_PATH_ESCAPES = { '%': '%%' } satisfies Record<string, string>

const ENVIRONMENT_VALUE_ESCAPES = {
  '\\': '\\\\',
  '"': '\\"',
  $: '\\$',
  '`': '\\`',
} satisfies Record<string, string>

const XML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
} satisfies Record<string, string>

const escapeWith = (escapes: Readonly<Record<string, string>>) => (text: string) =>
  pipe(
    Array.from(text),
    Arr.map((character) => escapes[character] ?? character),
    Arr.join(''),
  )

const systemdWord = (word: string) => `"${escapeWith(SYSTEMD_WORD_ESCAPES)(word)}"`

const xmlString = (text: string) => `    <string>${escapeWith(XML_ESCAPES)(text)}</string>`

export const shellWord = (word: string) => (SAFE_SHELL_WORD.test(word) ? word : shellQuoted(word))

export const shellCommand = (words: readonly string[]) => Arr.map(words, shellWord).join(' ')

export const environmentFileContents = (entries: readonly EnvironmentEntry[]) =>
  pipe(
    entries,
    Arr.map(({ name, value }) => `${name}="${escapeWith(ENVIRONMENT_VALUE_ESCAPES)(value)}"\n`),
    Arr.join(''),
  )

export const systemdUnit = ({ program, environmentFile }: ServiceDefinitionInput) =>
  [
    '[Unit]',
    "Description=crook agent, the link between this machine's herdr and the crook hub",
    '',
    '[Service]',
    'Type=exec',
    `ExecStart=${Arr.map([...program, RUN_SUBCOMMAND], systemdWord).join(' ')}`,
    `EnvironmentFile=${escapeWith(SYSTEMD_PATH_ESCAPES)(environmentFile)}`,
    'Restart=on-failure',
    `SuccessExitStatus=${INTERRUPTED_EXIT_CODE}`,
    'StandardOutput=journal',
    'StandardError=journal',
    `SyslogIdentifier=${SERVICE_NAME}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')

export const launchdPlist = ({ program, environmentFile, logFile }: LaunchdDefinitionInput) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LAUNCHD_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...Arr.map(
      ['/bin/sh', '-c', LAUNCHD_ENVIRONMENT_WRAPPER, environmentFile, ...program, RUN_SUBCOMMAND],
      xmlString,
    ),
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>StandardOutPath</key>',
    `  <string>${escapeWith(XML_ESCAPES)(logFile)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${escapeWith(XML_ESCAPES)(logFile)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
