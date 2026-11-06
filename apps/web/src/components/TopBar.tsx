import { IconEdit, IconPlayerPlayFilled } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import type { ReactNode } from "react"
import { openInGameProblem } from "../domain/gameLink"
import { openInGame, playMap } from "../editor/actions"
import { exportProblemOf, projectTitleOf, projectUnsavedOf, useEditor } from "../editor/store"
import { KeyChip } from "./KeyChip"
import { Logo } from "./Logo"
import { MenuBar } from "./MenuBar"

/** Out of the title bar's drag region: a drag region takes the pointer, so a tooltip inside one never shows. */
const NO_DRAG = "[-webkit-app-region:no-drag]"

/**
 * A button that sends the open map to the game (desktop), off with the reason while the map can't be exported. Its
 * tooltip opens along the bar: these sit over the inspector's tab strip, so anything below would cover the strip's tab
 * and ⋯.
 */
function GameButton({ children, onClick, tooltip, variant }: {
  readonly children: ReactNode
  readonly onClick: () => void
  readonly tooltip: ReactNode
  readonly variant?: "outline"
}) {
  const canPlay = useEditor((s) => s.capabilities.play)
  const refused = useEditor(exportProblemOf)
  if (!canPlay) return null
  if (refused !== null) {
    return (
      // keyed: switching tabs would otherwise reuse the enabled button's tooltip, which then never opens on the wrapper
      <Tooltip key="refused">
        {/* a disabled button gets no pointer events, so the tooltip lives on a wrapper */}
        <TooltipTrigger render={<span className={`cursor-not-allowed ${NO_DRAG}`} />}>
          <Button disabled variant={variant}>{children}</Button>
        </TooltipTrigger>
        <TooltipContent side="left">{refused}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant={variant} onClick={onClick} />}>{children}</TooltipTrigger>
      <TooltipContent side="left">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Open in game: exports the open map and opens it in the in-game editor. Once it is open there, Update in game:
 * exports and reloads it, so the game shows the latest version. The tooltip says when the game's copy is older.
 */
function OpenInGameButton() {
  const openedInGame = useEditor((s) => s.openedInGame !== null && s.openedInGame === s.file?.name)
  const problem = useEditor((s) => s.pluginStatus === null ? null : openInGameProblem(s.pluginStatus))
  const olderInGame = useEditor((s) =>
    openedInGame && s.projectMaps.find((m) => m.fileName === s.file?.name)?.link?.exportedWhileRunning === true
  )
  return (
    <GameButton
      variant="outline"
      onClick={() => void openInGame()}
      tooltip={
        <span className="flex flex-col gap-1">
          <span>
            {openedInGame
              ? `Export and reload it in the in-game editor.${olderInGame ? " The game shows an older version." : ""}`
              : "Export and open it in the in-game editor"}
          </span>
          {problem !== null && <span className="text-fg-tertiary">{problem}. Press for the steps.</span>}
        </span>
      }
    >
      <IconEdit data-icon="inline-start" />
      {openedInGame ? "Update in game" : "Open in game"}
    </GameButton>
  )
}

/** Play: exports the open map and races it in the game. Its tooltip shows the keybind (F5). */
function PlayButton() {
  const keybinds = useEditor((s) => s.keybinds.playMap)
  return (
    <GameButton
      onClick={() => void playMap()}
      tooltip={
        <>
          Export and race it in the game
          {keybinds.map((binding) => <KeyChip key={binding} binding={binding} />)}
        </>
      }
    >
      <IconPlayerPlayFilled data-icon="inline-start" />
      Play
    </GameButton>
  )
}

/**
 * In the desktop app this is the window's title bar (docs/DESKTOP.md § Window): it drags the window, and Electron
 * draws the window controls over one end of it. The padding keeps clear of them: `titlebar-area-*` is the part of
 * the bar they leave free, on whichever side the desktop puts them, so `titlebar-area-x` is 0 with the controls on the
 * right and their width with them on the left. A browser defines neither, so it gets plain padding and no drag.
 */
const TITLE_BAR_CLASSES = [
  "[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]",
  "pl-[calc(env(titlebar-area-x,0px)_+_0.5rem)]",
  "pr-[calc(100vw_-_env(titlebar-area-width,100vw)_-_env(titlebar-area-x,0px)_+_0.5rem)]"
].join(" ")

/**
 * The window's title: the project in use (desktop), centred like any document window's, its folder on hover. The dot
 * is the document tab's: a tab has unsaved edits.
 */
function ProjectTitle() {
  const state = useEditor((s) => s.project)
  const name = useEditor(projectTitleOf)
  const unsaved = useEditor(projectUnsavedOf)
  if (state === null || name === null) return null
  const project = state.current
  return (
    // Centred in the bar at the name's own width. A box spanning the bar would inherit the bar's drag region and,
    // coming after the menus, cover their no-drag middle (pointer-events doesn't apply to drag regions).
    <span
      className="absolute inset-x-0 mx-auto flex w-fit max-w-[40vw] items-center gap-1.5 text-body text-fg-secondary"
      title={project?.path ?? "Not saved anywhere yet: Save the map to name the project."}
    >
      <span className="truncate">{name}</span>
      {unsaved && <span className="size-1.5 shrink-0 rounded-full bg-dirty" aria-label="unsaved" />}
    </span>
  )
}

export function TopBar() {
  const catalog = useEditor((s) => s.catalog)

  return (
    <header className={`relative flex h-10 shrink-0 items-center gap-1 border-b bg-card ${TITLE_BAR_CLASSES}`}>
      <span className="mr-2 flex shrink-0 items-center gap-2 px-1 text-body-strong">
        <Logo className="size-4" />
        Ballest Editor
      </span>
      <MenuBar />
      <ProjectTitle />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {catalog?.warning !== undefined && <Badge variant="warn" title={catalog.warning}>Fixture catalog</Badge>}
        <OpenInGameButton />
        <PlayButton />
      </div>
    </header>
  )
}
