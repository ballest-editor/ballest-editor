import { IconPlayerPlayFilled } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect } from "react"
import { formatBinding } from "../domain/Keybinds"
import { playMap } from "../editor/actions"
import { useEditor } from "../editor/store"
import { MenuBar } from "./MenuBar"

/** Play (desktop): exports the open map and races it in the game. Its tooltip shows the keybind (F5). */
function PlayButton() {
  const canPlay = useEditor((s) => s.capabilities.play)
  const keybinds = useEditor((s) => s.keybinds.playMap)
  if (!canPlay) return null
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

/**
 * The window's title: the project in use (desktop), centred like any document window's, its folder on hover. With
 * none it is Untitled Project, starred because nothing is on disk yet (docs/PROJECTS.md § Shell).
 */
function ProjectTitle() {
  const state = useEditor((s) => s.project)
  const name = state === null ? null : state.current === null ? "Untitled Project *" : state.current.name
  // the OS window title too, so the taskbar and alt-tab tell projects apart
  useEffect(() => {
    document.title = name === null ? "Ballest Editor" : `${name} – Ballest Editor`
  }, [name])
  if (state === null || name === null) return null
  const project = state.current
  return (
    // the strip spans the bar (centring) but lets clicks through to the menus; only the name itself takes the hover
    <div className="pointer-events-none absolute inset-x-0 flex justify-center">
      <span
        className={cn(
          "pointer-events-auto max-w-[40vw] truncate text-xs text-muted-foreground",
          project === null && "italic"
        )}
        title={project?.path ?? "Not saved anywhere yet: Save the map to name the project."}
      >
        {name}
      </span>
    </div>
  )
}

export function TopBar() {
  const catalog = useEditor((s) => s.catalog)

  return (
    <header className={`relative flex h-10 shrink-0 items-center gap-1 border-b bg-card ${TITLE_BAR_CLASSES}`}>
      <span className="mr-2 px-1 text-sm font-semibold">Ballest Editor</span>
      <MenuBar />
      <ProjectTitle />
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
