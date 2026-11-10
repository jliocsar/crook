import * as BunServices from '@effect/platform-bun/BunServices'
import { expect, it, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'

import {
  LAUNCHD_ENVIRONMENT_WRAPPER,
  environmentFileContents,
  launchdPlist,
  shellCommand,
  systemdUnit,
} from '@crook/agent/ServiceDefinition'

const COMPILED_AGENT = '/opt/crook/crook-agent'
const ENVIRONMENT_FILE = '/home/jc/.config/crook/agent.env'
const AWKWARD_VALUE = 'a "quoted" $HOME `date` back\\slash 50% it\'s\nsecond line'

it('writes a systemd user unit that runs this program with its settings from the environment file', () => {
  expect(systemdUnit({ program: [COMPILED_AGENT], environmentFile: ENVIRONMENT_FILE })).toBe(
    [
      '[Unit]',
      "Description=crook agent, the link between this machine's herdr and the crook hub",
      '',
      '[Service]',
      'Type=exec',
      'ExecStart="/opt/crook/crook-agent" "run"',
      'EnvironmentFile=/home/jc/.config/crook/agent.env',
      'Restart=on-failure',
      'SuccessExitStatus=130',
      'StandardOutput=journal',
      'StandardError=journal',
      'SyslogIdentifier=crook-agent',
      '',
      '[Install]',
      'WantedBy=default.target',
      '',
    ].join('\n'),
  )
})

it('quotes each ExecStart word so spaces, quotes, specifiers and variables reach the program as written', () => {
  const unit = systemdUnit({
    program: ['/home/jc/my tools/bun', '/home/jc/100% "crook"/$main.ts'],
    environmentFile: '/home/jc/.config/50%/agent.env',
  })

  expect(unit).toContain(
    'ExecStart="/home/jc/my tools/bun" "/home/jc/100%% \\"crook\\"/$$main.ts" "run"',
  )
  expect(unit).toContain('EnvironmentFile=/home/jc/.config/50%%/agent.env')
})

it('writes a launchd agent that sources the environment file and keeps the agent up after a failure', () => {
  expect(
    launchdPlist({
      program: [COMPILED_AGENT],
      environmentFile: '/Users/jc/.config/crook/agent.env',
      logFile: '/Users/jc/Library/Logs/crook-agent.log',
    }),
  ).toBe(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>Label</key>',
      '  <string>crook-agent</string>',
      '  <key>ProgramArguments</key>',
      '  <array>',
      '    <string>/bin/sh</string>',
      '    <string>-c</string>',
      '    <string>set -a &amp;&amp; . &quot;$0&quot; &amp;&amp; exec &quot;$@&quot;</string>',
      '    <string>/Users/jc/.config/crook/agent.env</string>',
      '    <string>/opt/crook/crook-agent</string>',
      '    <string>run</string>',
      '  </array>',
      '  <key>RunAtLoad</key>',
      '  <true/>',
      '  <key>KeepAlive</key>',
      '  <dict>',
      '    <key>SuccessfulExit</key>',
      '    <false/>',
      '  </dict>',
      '  <key>StandardOutPath</key>',
      '  <string>/Users/jc/Library/Logs/crook-agent.log</string>',
      '  <key>StandardErrorPath</key>',
      '  <string>/Users/jc/Library/Logs/crook-agent.log</string>',
      '</dict>',
      '</plist>',
      '',
    ].join('\n'),
  )
})

it('escapes the XML in every plist string', () => {
  const plist = launchdPlist({
    program: ['/Users/jc/R&D <tools>/crook-agent'],
    environmentFile: ENVIRONMENT_FILE,
    logFile: '/Users/jc/Library/Logs/crook-agent.log',
  })

  expect(plist).toContain('<string>/Users/jc/R&amp;D &lt;tools&gt;/crook-agent</string>')
})

it('quotes only the shell words that need it', () => {
  expect(shellCommand(['/opt/crook agent/crook-agent', "it's", 'hook'])).toBe(
    "'/opt/crook agent/crook-agent' 'it'\\''s' hook",
  )
})

it('writes one double-quoted assignment per line', () => {
  expect(
    environmentFileContents([
      { name: 'CROOK_HUB_URL', value: 'wss://my-hub.exe.xyz/rpc/agent' },
      { name: 'CROOK_HUB_TOKEN', value: 'a"b$c`d\\e' },
    ]),
  ).toBe('CROOK_HUB_URL="wss://my-hub.exe.xyz/rpc/agent"\nCROOK_HUB_TOKEN="a\\"b\\$c\\`d\\\\e"\n')
})

layer(BunServices.layer, { excludeTestServices: true })('the environment file', (onDisk) => {
  onDisk.effect(
    'reads back every value unchanged through the shell the launchd agent starts with',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const file = `${yield* fileSystem.makeTempDirectoryScoped()}/agent.env`

        yield* fileSystem.writeFileString(
          file,
          environmentFileContents([
            { name: 'CROOK_HUB_TOKEN', value: AWKWARD_VALUE },
            { name: 'CROOK_MACHINE_LABEL', value: 'Work laptop' },
          ]),
        )
        const printed = yield* Effect.forEach(['CROOK_HUB_TOKEN', 'CROOK_MACHINE_LABEL'], (name) =>
          spawner.string(
            ChildProcess.make('/bin/sh', [
              '-c',
              LAUNCHD_ENVIRONMENT_WRAPPER,
              file,
              'printenv',
              name,
            ]),
          ),
        )

        expect(printed).toEqual([`${AWKWARD_VALUE}\n`, 'Work laptop\n'])
      }),
  )
})
