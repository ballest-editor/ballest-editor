import { badgeVariants } from "@workspace/ui/components/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { CHIP } from "./chipStyle"

/** A badge with a note in its tooltip, for a state worth seeing at a glance and explaining on request. */
export const HintBadge = ({ label, children }: { readonly label: string; readonly children: string }) => (
  <Tooltip>
    <TooltipTrigger
      aria-label={`${label}: ${children}`}
      className={cn(badgeVariants({ variant: "secondary" }), CHIP, "cursor-help focus-ring")}
    >
      {label}
    </TooltipTrigger>
    <TooltipContent className="max-w-60">{children}</TooltipContent>
  </Tooltip>
)
