import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { chooseGamePath, resetGamePaths, revealGamePath } from "../editor/actions"
import type { GamePath, GamePathKind, GamePaths, SettingsCategory } from "../editor/store"
import type { SettingsRow } from "./SettingsShell"

const LABELS: Record<GamePathKind, string> = {
  install: "Game folder",
  mapsFolder: "Maps folder",
  pluginsFolder: "Plugins folder"
}

export const GAME_PATH_KINDS: ReadonlyArray<GamePathKind> = ["install", "mapsFolder", "pluginsFolder"]

/** What the row says about how its folder was found, and what to do when it wasn't. */
const describe = (which: GamePathKind, { status, path }: GamePath): string => {
  if (status === "overridden") return "Chosen here instead of the one Steam knows about. Reset to look it up again."
  switch (which) {
    case "install":
      return status === "found"
        ? "Found through Steam."
        : "Steam doesn't list Ballest of Them All in any of its libraries. Choose the folder that holds Ballest/Binaries/Win64/Ballest-Win64-Shipping.exe."
    case "mapsFolder":
      if (status === "found") return "Save to game writes here, and the in-game editor lists the maps in it."
      return path === null
        ? "Couldn't work out where the game keeps its maps. Choose its UserSavedMaps folder."
        : "The game makes it the first time it runs. Start the game once, or choose the folder."
    case "pluginsFolder":
      return status === "found"
        ? "The plugin manager's plugins, next to the game's exe."
        : "Not there: the Ballest plugin manager isn't installed. Racing a map straight from the editor will need it."
  }
}

const STATUS_LABELS = { found: "Found", overridden: "Chosen", missing: "Not found" } as const

function GamePathControl({ which, path }: { readonly which: GamePathKind; readonly path: GamePath | undefined }) {
  const missing = path === undefined || path.status === "missing"
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        // A long path's end (the folder itself) matters more than its start: show that end.
        ref={(input) => {
          if (input !== null) input.scrollLeft = input.scrollWidth
        }}
        className="min-w-0 flex-1 font-mono text-xs"
        value={path?.path ?? ""}
        placeholder={path === undefined ? "Looking…" : "Not found"}
        title={path?.path ?? undefined}
        aria-label={LABELS[which]}
      />
      {path !== undefined && (
        <Badge
          className="w-16"
          variant={missing ? "destructive" : path.status === "overridden" ? "default" : "secondary"}
        >
          {STATUS_LABELS[path.status]}
        </Badge>
      )}
      <Button variant="outline" size="sm" onClick={() => void chooseGamePath(which)}>Choose…</Button>
      <Button variant="outline" size="sm" disabled={missing} onClick={() => void revealGamePath(which)}>
        Reveal
      </Button>
    </div>
  )
}

/** Settings › Game (desktop): the three game folders, each found through Steam or chosen here. */
export const gameSettingsRows = (paths: GamePaths | null): ReadonlyArray<SettingsRow<SettingsCategory>> =>
  GAME_PATH_KINDS.map((which) => {
    const path = paths?.[which]
    return {
      id: `game-${which}`,
      category: "game",
      label: LABELS[which],
      description: path === undefined ? "Looking for the game…" : describe(which, path),
      keywords: "steam proton install UserSavedMaps plugins path folder",
      wide: true,
      changes: { modified: path?.status === "overridden", reset: () => void resetGamePaths([which]) },
      control: <GamePathControl which={which} path={path} />
    }
  })
