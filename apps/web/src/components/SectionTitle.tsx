import type { ReactNode } from "react"

export const SectionTitle = ({ children }: { readonly children: ReactNode }) => (
  <div className="text-caption uppercase tracking-wider text-fg-secondary">{children}</div>
)
