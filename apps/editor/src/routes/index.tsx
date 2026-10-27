import { createFileRoute } from "@tanstack/react-router"
import { Editor } from "../components/Editor"
import { EditorSkeleton } from "../components/EditorSkeleton"

// The editor is WebGL + localStorage + File APIs: render it on the client only.
export const Route = createFileRoute("/")({
  ssr: false,
  component: Editor,
  pendingComponent: EditorSkeleton
})
