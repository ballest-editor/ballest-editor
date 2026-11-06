import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"

/** An icon button in a panel's header. A disabled button takes no pointer events, so the tooltip is on a wrapper. */
export function HeaderButton({ label, pressed, disabled, className, onClick, children }: {
  readonly label: string
  readonly pressed?: boolean
  readonly disabled?: boolean
  /** On the wrapper. */
  readonly className?: string
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("inline-flex", className)} />}>
        <Button
          variant={pressed === true ? "secondary" : "ghost"}
          size="icon-sm"
          className="text-fg-secondary"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
