import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"

/** An eyebrow's type, for one that's a control and can't be a `SectionTitle`. */
export const EYEBROW = "text-caption uppercase tracking-wider text-fg-secondary"

export const SectionTitle = ({ children }: { readonly children: ReactNode }) => (
  <div className={cn(EYEBROW, "dark:text-foreground")}>{children}</div>
)
