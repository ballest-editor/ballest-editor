import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { useState } from "react"
import { chooseGamePath, installPlugin, openExternalLink, resetGamePaths, revealGamePath } from "../editor/actions"
import type { GamePath, GamePathKind, GamePaths, PluginStatus, SettingsCategory } from "../editor/store"
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
      if (status === "found") return "Export to game writes here, and the in-game editor lists the maps in it."
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

/** A folder's path, read-only, scrolled to its end. */
function PathField(
  { path, looking, label }: { readonly path: string | null; readonly looking: boolean; readonly label: string }
) {
  return (
    <Input
      readOnly
      // A long path's end (the folder itself) matters more than its start: show that end.
      ref={(input) => {
        if (input !== null) input.scrollLeft = input.scrollWidth
      }}
      className="min-w-0 flex-1 font-mono text-xs"
      value={path ?? ""}
      placeholder={looking ? "Looking…" : "Not found"}
      title={path ?? undefined}
      aria-label={label}
    />
  )
}

function GamePathControl({ which, path }: { readonly which: GamePathKind; readonly path: GamePath | undefined }) {
  const missing = path === undefined || path.status === "missing"
  return (
    <div className="flex items-center gap-2">
      <PathField path={path?.path ?? null} looking={path === undefined} label={LABELS[which]} />
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

/** The plugin manager's site, which has its install steps. */
const PLUGIN_MANAGER_URL = "https://anythinggoes-ballest.github.io/ballest-plugin-manager/"

const PLAY_NEEDS_IT = "Play races the open map in the game through this plugin."

const describePlugin = (plugin: PluginStatus): string => {
  switch (plugin.status) {
    case "noGame":
      return `${PLAY_NEEDS_IT} It goes in the game's plugins folder: find the game first.`
    case "noPluginManager":
      return `${PLAY_NEEDS_IT} It runs in the Ballest plugin manager, which isn't installed. Install that first.`
    case "missing":
      return plugin.installedVersion === null
        ? `${PLAY_NEEDS_IT} It isn't installed.`
        : "Some of its files are missing from the plugins folder. Install puts them back."
    case "outdated":
      return `Version ${plugin.installedVersion} is installed; this app comes with ${plugin.bundledVersion}.`
    case "current":
      return `Version ${plugin.installedVersion} is installed. ${PLAY_NEEDS_IT}`
  }
}

const PLUGIN_LABELS: Record<PluginStatus["status"], string> = {
  noGame: "No game",
  noPluginManager: "No plugin manager",
  missing: "Not installed",
  outdated: "Outdated",
  current: "Installed"
}

function PluginControl({ plugin }: { readonly plugin: PluginStatus | null }) {
  const [installing, setInstalling] = useState(false)
  const status = plugin?.status
  const blocked = status === undefined || status === "noGame" || status === "noPluginManager"
  const install = () => {
    setInstalling(true)
    void installPlugin().finally(() => setInstalling(false))
  }
  return (
    <div className="flex items-center gap-2">
      <PathField path={plugin?.folder ?? null} looking={plugin === null} label="Editor plugin folder" />
      {status !== undefined && (
        <Badge
          variant={blocked || status === "missing" ? "destructive" : status === "outdated" ? "default" : "secondary"}
        >
          {PLUGIN_LABELS[status]}
        </Badge>
      )}
      {status === "noPluginManager" && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openExternalLink(PLUGIN_MANAGER_URL)}
        >
          Install steps
        </Button>
      )}
      <Button size="sm" disabled={blocked || status === "current" || installing} onClick={install}>
        {status === "outdated" ? "Update" : "Install"}
      </Button>
    </div>
  )
}

/**
 * Settings › Game (desktop): the three game folders, each found through Steam or chosen here, then the editor-link
 * plugin Play needs, with Install / Update.
 */
export const gameSettingsRows = (
  paths: GamePaths | null,
  plugin: PluginStatus | null
): ReadonlyArray<SettingsRow<SettingsCategory>> => [
  ...GAME_PATH_KINDS.map((which): SettingsRow<SettingsCategory> => {
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
  }),
  {
    id: "game-plugin",
    category: "game",
    label: "Editor plugin",
    description: plugin === null ? "Looking for the plugin…" : describePlugin(plugin),
    keywords: "ballest-editor-link plugin manager play race install update version",
    wide: true,
    control: <PluginControl plugin={plugin} />
  }
]
