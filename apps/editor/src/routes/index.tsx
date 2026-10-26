import { createFileRoute } from "@tanstack/react-router"
import { Editor } from "../components/Editor"

// The editor is WebGL + localStorage + File APIs: render it on the client only.
export const Route = createFileRoute("/")({
  ssr: false,
  component: Editor,
  pendingComponent: () => <div className="p-8 text-sm text-muted-foreground">Loading editor…</div>
})
