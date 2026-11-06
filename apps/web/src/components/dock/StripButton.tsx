import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import type { ComponentProps } from "react"

/** An icon button in a tab strip, named by its tooltip. */
export function StripButton({ label, ...props }: { readonly label: string } & ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" className="text-fg-secondary" aria-label={label} {...props} />}
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
