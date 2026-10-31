import { Badge } from "@workspace/ui/components/badge"
import { useEditor } from "../editor/store"
import { MenuBar } from "./MenuBar"

const latestRelease = "https://github.com/ballest-editor/ballest-editor/releases/latest"

/** The deployed web build (Vercel, for reviewing pull requests and `main`), not the desktop app or `pnpm dev`. */
const isReviewBuild = import.meta.env.PROD && window.ballest === undefined

export function TopBar() {
  const catalog = useEditor((s) => s.catalog)

  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b bg-card px-2">
      <span className="mr-2 px-1 text-sm font-semibold">Ballest Editor</span>
      <MenuBar />
      <div className="ml-auto flex items-center gap-1">
        {catalog?.warning !== undefined && (
          <Badge variant="outline" className="text-amber-500" title={catalog.warning}>
            Fixture catalog
          </Badge>
        )}
        {isReviewBuild && (
          <Badge
            variant="outline"
            title="This web build is for reviewing changes. The editor is the desktop app."
            render={<a href={latestRelease} target="_blank" rel="noreferrer" />}
          >
            Review build: download the desktop app
          </Badge>
        )}
      </div>
    </header>
  )
}
