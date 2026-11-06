import { type Icon, IconFolder } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"

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

/**
 * A location as a settings row shows it: a field-like box with a folder icon, the path (`PathText`) and its actions
 * (Reveal, Change…) docked at the right, so every location row lines up. `missing` is shown, muted, when there is no
 * path yet.
 */
export function PathField({ path, missing = "Not found", icon: FieldIcon = IconFolder, actions }: {
  readonly path: string | null
  readonly missing?: string
  /** A folder by default; `IconFile` for a file name. */
  readonly icon?: Icon
  readonly actions?: ReactNode
}) {
  return (
    <div className="flex h-8 w-full min-w-0 items-center gap-2 rounded-control border bg-muted/40 pr-1 pl-2.5">
      <FieldIcon className="size-3.5 shrink-0 text-fg-secondary" />
      {path === null
        ? <span className="min-w-0 flex-1 truncate text-body text-fg-tertiary italic">{missing}</span>
        : <PathText className="flex-1 text-foreground/90">{path}</PathText>}
      {actions !== undefined && <div className="flex shrink-0 items-center gap-0.5 border-l pl-1">{actions}</div>}
      {actions === undefined && <span className="w-1" />}
    </div>
  )
}

/** An icon button, its name in the tooltip: a `PathField`'s actions, and the Inspector's section headers. */
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
