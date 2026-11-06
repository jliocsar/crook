import { Plus } from 'lucide-react'

import { Sheet } from '@crook/web/components/Sheet'
import { Button } from '@crook/web/components/ui/button'
import { CodeBlock } from '@crook/web/components/ui/code-block'
import { agentSocketUrl } from '@crook/web/rpc/HubConnection'

export const PLUGIN_INSTALL_COMMAND = 'herdr plugin install jliocsar/crook/packages/agent/plugin'
export const TOKEN_CONTEXT = '{ "machine": "<name>" }'

const setupSteps = (hubUrl: string) => [
  {
    text: 'On the machine, install the crook plugin for Herdr.',
    code: PLUGIN_INSTALL_COMMAND,
    language: 'sh',
  },
  {
    text: 'In Herdr, run the plugin\'s "Connect to hub" action and give it this hub.',
    code: hubUrl,
    language: 'url',
  },
  {
    text: "Paste an exe.dev token for the hub VM, minted with the machine's name as its context.",
    code: TOKEN_CONTEXT,
    language: 'json',
  },
]

export function AddMachineButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button variant="ghost" size="icon-touch" aria-label="Add a machine" onClick={onOpen}>
      <Plus className="size-6" />
    </Button>
  )
}

export function AddMachineSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hubUrl = agentSocketUrl(new URL(window.location.href)).href

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a machine"
      description="Any machine running Herdr can join."
    >
      <ol className="grid gap-4">
        {setupSteps(hubUrl).map((step, index) => (
          <li key={step.code} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-2">
            <span className="bg-muted text-muted-foreground inline-flex size-6 items-center justify-center rounded-full font-mono text-xs">
              {index + 1}
            </span>
            <p className="text-sm leading-5">{step.text}</p>
            <CodeBlock className="col-start-2" code={step.code} language={step.language} wrap />
          </li>
        ))}
        <li className="text-muted-foreground grid grid-cols-[1.5rem_1fr] gap-x-2 text-sm leading-5">
          <span />
          It shows up under Machines as soon as it connects.
        </li>
      </ol>
    </Sheet>
  )
}
