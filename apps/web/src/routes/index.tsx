import { createFileRoute } from "@tanstack/react-router"
import { Editor } from "../components/Editor"
import { EditorSkeleton } from "../components/EditorSkeleton"

// The skeleton shows from the first frame while the editor's chunk loads.
export const Route = createFileRoute("/")({
  component: Editor,
  pendingComponent: EditorSkeleton,
  pendingMs: 0,
  pendingMinMs: 0
})
