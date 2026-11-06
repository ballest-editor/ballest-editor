import { Kbd } from "@workspace/ui/components/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import type { ComponentProps, ReactElement, ReactNode } from "react"
import { formatBinding, type KeybindAction } from "../domain/Keybinds"
import { useEditor } from "../editor/store"

/** A viewport control (`render`) with its tooltip: what it does, and the keys that do the same, if any do. */
export function ViewTip({ label, action, side = "bottom", render, children }: {
  readonly label: string
  readonly action?: KeybindAction | undefined
  readonly side?: ComponentProps<typeof TooltipContent>["side"]
  readonly render: ReactElement
  readonly children: ReactNode
}) {
  const keybinds = useEditor((s) => s.keybinds)
  return (
    <Tooltip>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {action !== undefined && keybinds[action].map((binding) => <Kbd key={binding}>{formatBinding(binding)}</Kbd>)}
      </TooltipContent>
    </Tooltip>
  )
}
