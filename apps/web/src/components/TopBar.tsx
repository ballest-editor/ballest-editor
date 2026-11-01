import { IconPlayerPlayFilled } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { formatBinding } from "../domain/Keybinds"
import { playMap } from "../editor/actions"
import { useEditor, useOpenMapLabel } from "../editor/store"
import { MenuBar } from "./MenuBar"

/** The open map's name, with a dot while it has unsaved changes; its file's path (desktop) on hover. */
function FileName() {
  const file = useEditor((s) => s.file)
  const dirty = useEditor((s) => s.dirty)
  const mapOpen = useEditor((s) => s.mapOpen)
  const label = useOpenMapLabel()
  if (!mapOpen) return null
  return (
    <span
      className="ml-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      title={file?.path ?? undefined}
    >
      <span className="truncate">{label}</span>
      {dirty && <span className="size-1.5 shrink-0 rounded-full bg-foreground/60" aria-label="unsaved changes" />}
    </span>
  )
}

/** Play (desktop): exports the open map and races it in the game. Its tooltip shows the keybind (F5). */
function PlayButton() {
  const canPlay = useEditor((s) => s.capabilities.play)
  const mapOpen = useEditor((s) => s.mapOpen)
  const keybinds = useEditor((s) => s.keybinds.playMap)
  if (!canPlay || !mapOpen) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2" onClick={() => void playMap()} />}
      >
        <IconPlayerPlayFilled className="size-3.5 text-emerald-500" />
        Play
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-1.5">
        Export and race it in the game
        {keybinds.map((binding) => <Kbd key={binding}>{formatBinding(binding)}</Kbd>)}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * In the desktop app this is the window's title bar (docs/DESKTOP.md § Window): it drags the window, and Electron
 * draws the window controls over one end of it. The padding keeps clear of them: `titlebar-area-*` is the part of
 * the bar they leave free, on whichever side the desktop puts them. A browser defines neither, so it gets plain
 * padding and no drag.
 */
const TITLE_BAR_CLASSES = [
  "[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]",
  "pl-[calc(env(titlebar-area-x,0px)_+_0.5rem)]",
  "pr-[calc(100vw_-_env(titlebar-area-width,100vw)_-_env(titlebar-area-x,0px)_+_0.5rem)]"
].join(" ")

export function TopBar() {
  const catalog = useEditor((s) => s.catalog)

  return (
    <header className={`flex h-10 shrink-0 items-center gap-1 border-b bg-card ${TITLE_BAR_CLASSES}`}>
      <span className="mr-2 px-1 text-sm font-semibold">Ballest Editor</span>
      <MenuBar />
      <FileName />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <PlayButton />
        {catalog?.warning !== undefined && (
          <Badge variant="outline" className="text-amber-500" title={catalog.warning}>
            Fixture catalog
          </Badge>
        )}
      </div>
    </header>
  )
}
