import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import type { ComponentProps } from "react"

/**
 * An icon button in a tab strip, named by its tooltip. The tooltip is for the pointer: focus coming back from a menu that
 * closed would otherwise bring it up with nothing hovered.
 */
export function StripButton({ label, ...props }: { readonly label: string } & ComponentProps<typeof Button>) {
  return (
    <Tooltip
      onOpenChange={(open, details) => {
        if (open && details.reason === "trigger-focus") details.cancel()
      }}
    >
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" className="text-fg-secondary" aria-label={label} {...props} />}
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
