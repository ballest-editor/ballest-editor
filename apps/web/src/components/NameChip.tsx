import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"

/** A small pill by a name, saying what kind of thing it is: a definition's tier, a restored backup. */
export function NameChip({ className, children }: { readonly className?: string; readonly children: ReactNode }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-status-neutral px-1.5 text-caption text-status-neutral-foreground",
        className
      )}
    >
      {children}
    </span>
  )
}
