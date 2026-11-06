import type { Icon } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

/**
 * A file path or file name, wherever one is shown: small, on one line. Too long for its room, it is cut at
 * the start, so the end (the file, the folder itself) stays readable, and the whole thing is the tooltip. Paths never
 * wrap: a path broken over three lines reads worse than a cut one with a tooltip.
 *
 * `block` puts it on a line of its own, for prose that mentions a file ("Exports as" + the file name).
 */
export function PathText({ children, className, block = false }: {
  readonly children: string
  readonly className?: string
  readonly block?: boolean
}) {
  return (
    <span
      className={cn(
        "min-w-0 truncate text-left text-caption leading-none",
        block ? "block py-0.5" : "inline-block max-w-full align-bottom",
        className
      )}
      dir="rtl"
      title={children}
    >
      {/* rtl cuts the start; bdi keeps the characters in their order */}
      <bdi>{children}</bdi>
    </span>
  )
}

/** An icon button, its name in the tooltip: a location row's actions, and the Inspector's section headers. */
export function PathAction({ label, icon: ActionIcon, onClick, disabled = false, className }: {
  readonly label: string
  readonly icon: Icon
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("text-fg-secondary", className)}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        <ActionIcon />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
