import { type Icon, IconCheck, IconCopy } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useState } from "react"
import { copyText } from "../editor/actions"

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

/** Copies a path; the icon says it worked for a moment. */
export function CopyPathAction({ path }: { readonly path: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <PathAction
      label={copied ? "Copied" : "Copy path"}
      icon={copied ? IconCheck : IconCopy}
      onClick={() => void copyText(path).then((done) => setCopied(done === true))}
    />
  )
}
