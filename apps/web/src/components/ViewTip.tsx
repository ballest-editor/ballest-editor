import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import type { ComponentProps, ReactElement, ReactNode } from "react"
import type { KeybindAction } from "../domain/Keybinds"
import { useEditor } from "../editor/store"
import { KeyChip } from "./KeyChip"

/**
 * A viewport control (`render`) with its tooltip: what it does, and the keys that do the same, if any do. Only the
 * pointer opens it: these controls are pointer-only, and focus comes back to one whenever its menu closes.
 */
export function ViewTip({ label, action, side = "bottom", render, children }: {
  readonly label: string
  readonly action?: KeybindAction | undefined
  readonly side?: ComponentProps<typeof TooltipContent>["side"]
  readonly render: ReactElement
  readonly children: ReactNode
}) {
  const keybinds = useEditor((s) => s.keybinds)
  return (
    <Tooltip
      onOpenChange={(open, details) => {
        if (open && details.reason === "trigger-focus") details.cancel()
      }}
    >
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {action !== undefined && keybinds[action].map((binding) => <KeyChip key={binding} binding={binding} />)}
      </TooltipContent>
    </Tooltip>
  )
}
