import { Badge } from "@workspace/ui/components/badge"
import { useEditor } from "../editor/store"
import { MenuBar } from "./MenuBar"

export function TopBar() {
  const catalog = useEditor((s) => s.catalog)

  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b bg-card px-2">
      <span className="mr-2 px-1 text-sm font-semibold">Ballest Editor</span>
      <MenuBar />
      {catalog?.warning !== undefined && (
        <Badge variant="outline" className="ml-auto text-amber-500" title={catalog.warning}>
          Fixture catalog
        </Badge>
      )}
    </header>
  )
}
