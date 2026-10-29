import type { ReactNode } from "react"

export const SectionTitle = ({ children }: { readonly children: ReactNode }) => (
  <div className="text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase">{children}</div>
)
