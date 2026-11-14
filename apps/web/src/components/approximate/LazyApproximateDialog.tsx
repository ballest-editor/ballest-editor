/**
 * The approximation dialog, fetched the first time it opens: it brings six model loaders with it, and it is a beta
 * most users never turn on. Once fetched it stays mounted, so closing it keeps the model and the result.
 */
import { lazy, Suspense, useState } from "react"

const ApproximateDialog = lazy(() => import("./ApproximateDialog"))

export function LazyApproximateDialog({ onClose, open }: { readonly open: boolean; readonly onClose: () => void }) {
  const [opened, setOpened] = useState(open)
  if (open && !opened) setOpened(true)
  return opened && (
    <Suspense fallback={null}>
      <ApproximateDialog open={open} onClose={onClose} />
    </Suspense>
  )
}
