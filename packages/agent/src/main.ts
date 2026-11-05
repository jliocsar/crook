import { forwardStdin, isBareHookCall } from '@crook/agent/HookForwarder'

if (isBareHookCall(Bun.argv)) {
  forwardStdin(() => process.exit())
} else {
  await import('@crook/agent/Cli')
}
