import { IconInfoCircle } from "@tabler/icons-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"

/** A small info icon holding a note that would be noise written out in the row. */
export const InfoHint = ({ children }: { readonly children: string }) => (
  <Tooltip>
    <TooltipTrigger
      aria-label={children}
      className="flex shrink-0 cursor-help items-center rounded-control text-fg-tertiary transition-colors focus-ring hover:text-fg-secondary"
    >
      <IconInfoCircle className="size-4" />
    </TooltipTrigger>
    <TooltipContent className="max-w-60">{children}</TooltipContent>
  </Tooltip>
)
