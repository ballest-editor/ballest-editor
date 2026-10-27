import { IconDownload, IconFilePlus, IconSettings, IconUpload } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"
import { commands } from "../editor/commands"
import { useEditor } from "../editor/store"

export function TopBar() {
  const catalog = useEditor((s) => s.catalog)
  const openDialog = useEditor((s) => s.openDialog)

  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b bg-card px-2">
      <span className="mr-2 px-1 text-sm font-semibold">Ballest Editor</span>
      <Button variant="ghost" size="sm" onClick={() => openDialog("new")}>
        <IconFilePlus /> New
      </Button>
      <Button variant="ghost" size="sm" onClick={() => commands.openImport()}>
        <IconUpload /> Import
      </Button>
      <Button variant="ghost" size="sm" onClick={() => openDialog("export")}>
        <IconDownload /> Export
      </Button>
      <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-center" />
      {/* TODO(menu-bar): move into a universal menu bar (Edit > Settings…) */}
      <Button variant="ghost" size="sm" onClick={() => openDialog("settings")}>
        <IconSettings /> Settings
      </Button>
      {catalog?.warning !== undefined && (
        <Badge variant="outline" className="ml-auto text-amber-500" title={catalog.warning}>
          Fixture catalog
        </Badge>
      )}
    </header>
  )
}
