import { Share, SquarePlus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { motion, stagger } from 'motion/react'
import type { Variants } from 'motion/react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import type { InstallBrowser } from '@/install/InstallBrowser'
import { motionTokens } from '@/motion/MotionTokens'
import { useTransformString } from '@/motion/TransformString'

type Step = { readonly text: string; readonly hint: string | null; readonly Icon: LucideIcon }

const STAGGER_SECONDS = 0.05
const RISE_DISTANCE = 6
const ICON_FROM_SCALE = 0.96
const HERO_ICON_SIZE = 88
const STEP_ICON_SIZE = 36
const APP_ICON_SOURCE = '/apple-touch-icon-180x180.png'
const ADD_TO_HOME_SCREEN: Step = { text: 'Choose Add to Home Screen', hint: null, Icon: SquarePlus }

export const INSTALL_STEPS = {
  safari: [
    { text: 'Tap Share in the toolbar', hint: "Can't see it? Tap ⋯ first.", Icon: Share },
    ADD_TO_HOME_SCREEN,
  ],
  chrome: [{ text: 'Tap Share in the address bar', hint: null, Icon: Share }, ADD_TO_HOME_SCREEN],
} satisfies Record<InstallBrowser, readonly Step[]>

const STAGGER: Variants = { shown: { transition: { delayChildren: stagger(STAGGER_SECONDS) } } }

function AppIcon({ size, className }: { size: number; className?: string }) {
  return (
    <img
      src={APP_ICON_SOURCE}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: '22.5%' }}
    />
  )
}

function StepRow({
  number,
  text,
  hint,
  trailing,
  rise,
}: {
  number: number
  text: string
  hint: string | null
  trailing: React.ReactNode
  rise: Variants
}) {
  return (
    <motion.li
      variants={rise}
      transition={motionTokens().fade}
      className="border-border bg-card flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2"
    >
      <span
        aria-hidden="true"
        className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs"
      >
        {number}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base leading-6">{text}</span>
        {hint === null ? null : (
          <span className="text-muted-foreground block text-sm leading-5">{hint}</span>
        )}
      </span>
      {trailing}
    </motion.li>
  )
}

export function InstallScreen({
  browser,
  onContinue,
}: {
  browser: InstallBrowser
  onContinue: () => void
}) {
  const transform = useTransformString()
  const fade = motionTokens().fade
  const rise: Variants = {
    hidden: { opacity: 0, transform: transform.translate('Y', RISE_DISTANCE) },
    shown: { opacity: 1, transform: transform.translate('Y', 0) },
  }
  const iconRise: Variants = {
    hidden: { opacity: 0, transform: transform.scale(ICON_FROM_SCALE) },
    shown: { opacity: 1, transform: transform.scale(1) },
  }
  const steps = INSTALL_STEPS[browser]

  return (
    <main className="mx-auto flex h-dvh max-w-[430px] flex-col px-6 pt-[calc(var(--safe-top)+3rem)] pb-[calc(var(--safe-bottom)+0.75rem)]">
      <motion.div
        initial="hidden"
        animate="shown"
        variants={STAGGER}
        className="flex flex-1 flex-col items-center justify-center text-center"
      >
        <motion.div variants={iconRise} transition={fade}>
          <AppIcon
            size={HERO_ICON_SIZE}
            className="shadow-[0_8px_24px_rgb(0_0_0/0.14),0_1px_2px_rgb(0_0_0/0.12)]"
          />
        </motion.div>
        <motion.h1
          variants={rise}
          transition={fade}
          className="font-display mt-6 text-2xl font-bold tracking-[-0.025em] text-balance"
        >
          Add crook to your Home Screen
        </motion.h1>
        <motion.p
          variants={rise}
          transition={fade}
          className="text-muted-foreground mx-auto mt-2 max-w-[34ch] text-base leading-6"
        >
          crook runs from your Home Screen, like an app. Logins are kept per app, so log in once
          it&apos;s there.
        </motion.p>
        <motion.ol variants={STAGGER} className="mt-8 grid w-full max-w-[22rem] gap-2 text-left">
          {steps.map((step, index) => (
            <StepRow
              key={step.text}
              number={index + 1}
              text={step.text}
              hint={step.hint}
              rise={rise}
              trailing={
                <span
                  aria-hidden="true"
                  className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"
                >
                  <step.Icon className="size-5" />
                </span>
              }
            />
          ))}
          <StepRow
            number={steps.length + 1}
            text="Open crook from your Home Screen"
            hint={null}
            rise={rise}
            trailing={<AppIcon size={STEP_ICON_SIZE} />}
          />
        </motion.ol>
      </motion.div>
      <Button
        variant="ghost"
        size="touch"
        className="text-muted-foreground text-base"
        onClick={onContinue}
      >
        Continue in browser
      </Button>
    </main>
  )
}
