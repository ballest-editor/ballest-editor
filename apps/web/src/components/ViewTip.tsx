import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type ComponentProps, createContext, type ReactElement, type ReactNode, use, useState } from "react"
import type { KeybindAction } from "../domain/Keybinds"
import { useEditor } from "../editor/store"
import { KeyChip } from "./KeyChip"
import { pointerOpensOnly } from "./viewControlStyle"

const ViewportElement = createContext<Element | null>(null)

/** Fills the viewport with `children`, the controls floating over it, and keeps their tooltips inside it. */
export function ViewTipBoundary({ children }: { readonly children: ReactNode }) {
  const [viewport, setViewport] = useState<Element | null>(null)
  return (
    <ViewportElement value={viewport}>
      <div ref={setViewport} className="pointer-events-none absolute inset-0">{children}</div>
    </ViewportElement>
  )
}

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
  const viewport = use(ViewportElement)
  return (
    <Tooltip onOpenChange={pointerOpensOnly}>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipContent side={side} collisionBoundary={viewport ?? undefined}>
        {label}
        {action !== undefined && keybinds[action].map((binding) => <KeyChip key={binding} binding={binding} />)}
      </TooltipContent>
    </Tooltip>
  )
}
