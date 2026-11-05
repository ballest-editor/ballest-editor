import type { ReactNode } from "react"

export const SectionTitle = ({ children }: { readonly children: ReactNode }) => (
  <div className="text-eyebrow text-muted-foreground">{children}</div>
)
