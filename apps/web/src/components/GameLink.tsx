import {
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconFolderOpen,
  IconFolderSearch,
  IconPencil,
  IconRefresh
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { type ComponentType, useState } from "react"
import {
  anythingMissing,
  type GameFolderKind,
  type GameLinkFix,
  type GameLinkRow,
  gameLinkRows,
  type GameLinkRowState,
  PLUGIN_MANAGER_URL
} from "../domain/gameLink"
import {
  chooseGameLinkFolder,
  installPlugin,
  openExternalLink,
  refreshGameLink,
  resetGamePaths,
  revealGamePath
} from "../editor/actions"
import { type SettingsCategory, useCreator, useEditor } from "../editor/store"
import { PathAction } from "./PathText"
import type { SettingsRow } from "./SettingsShell"

const ICONS: Record<GameLinkRowState, ComponentType<{ readonly className?: string }>> = {
  ok: IconCircleCheck,
  missing: IconCircleX,
  optional: IconCircleDashed,
  waiting: IconCircleDashed
}

const TONES: Record<GameLinkRowState, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  missing: "text-destructive",
  optional: "text-fg-tertiary",
  waiting: "text-fg-tertiary"
}

/** On the label's line: the icon is 16px, the line 20px. */
function StateIcon({ state }: { readonly state: GameLinkRowState }) {
  const Icon = ICONS[state]
  return <Icon className={cn("mt-0.5 size-4 shrink-0", TONES[state])} />
}

/**
 * A row's fix. On a row that is fine it is an icon button, which changes what was found; on one that isn't it says what
 * it does, filled when the row is missing and quiet on the optional plugin manager, since nothing is wrong without it.
 */
function FixButton({ fix, state }: { readonly fix: GameLinkFix; readonly state: GameLinkRowState }) {
  const openDialog = useEditor((s) => s.openDialog)
  const [busy, setBusy] = useState(false)
  const found = state === "ok"
  switch (fix._tag) {
    case "ChooseFolder":
      return found
        ? (
          <PathAction
            label="Choose another folder…"
            icon={IconFolderSearch}
            onClick={() => void chooseGameLinkFolder(fix.which)}
          />
        )
        : (
          <Button
            variant={state === "missing" ? "default" : "outline"}
            onClick={() => void chooseGameLinkFolder(fix.which)}
          >
            Choose folder…
          </Button>
        )
    case "OpenPluginDocs":
      return <Button variant="outline" onClick={() => void openExternalLink(PLUGIN_MANAGER_URL)}>Install docs</Button>
    case "InstallPlugin":
      return (
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void installPlugin().finally(() => setBusy(false))
          }}
        >
          {fix.update ? "Update" : "Install"}
        </Button>
      )
    case "EditCreator": {
      const edit = () => openDialog({ id: "settings", category: "general" })
      return found
        ? <PathAction label="Change in Settings › General" icon={IconPencil} onClick={edit} />
        : <Button onClick={edit}>Set name…</Button>
    }
  }
}

/** The folder a row's Choose folder… or Change… picks, whose refusal shows on that row. */
const chosenFolder = (row: GameLinkRow): GameFolderKind | null => {
  for (const fix of row.fixes) if (fix._tag === "ChooseFolder") return fix.which
  return null
}

/** The note and the full path: the only place a row spells either out. */
function RowInfo({ row }: { readonly row: GameLinkRow }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {row.note !== null && <span>{row.note}</span>}
      {row.path !== null && <span className="break-all">{row.path}</span>}
    </span>
  )
}

/** Reveal and the row's fixes, in one line at the right of the row. */
function RowActions({ row }: { readonly row: GameLinkRow }) {
  const { reveal } = row
  return (
    <>
      {reveal !== null && (
        <PathAction
          label="Reveal in file manager"
          icon={IconFolderOpen}
          onClick={() => void revealGamePath(reveal)}
        />
      )}
      {row.fixes.map((fix) => <FixButton key={fix._tag} fix={fix} state={row.state} />)}
    </>
  )
}

const useGameLinkRows = (): ReadonlyArray<GameLinkRow> => {
  const paths = useEditor((s) => s.gamePaths)
  const plugin = useEditor((s) => s.pluginStatus)
  const creator = useCreator()
  return gameLinkRows(paths, plugin, creator)
}

/** What the Game link dialog says over its rows: looking, all there, or what is still needed. */
export function useGameLinkSummary(): string {
  const rows = useGameLinkRows()
  const looking = useEditor((s) => s.gamePaths === null || s.pluginStatus === null)
  if (looking) return "Looking for the game…"
  return anythingMissing(rows)
    ? "Export, Launch game and Play need these."
    : "Everything Export and Launch game need is here."
}

const KEYWORDS =
  "steam proton install folder path UserSavedMaps maps plugins plugin manager ballest-editor-link editor plugin play update version"

/**
 * Settings › Game (docs/DESKTOP.md § Game link), the Game link's home: the game's install, its maps folder, the creator
 * name, the plugin manager and the editor plugin, each a settings row with its state, its status in one line, and
 * Reveal and its fix at the right. The full path is in the row's info. A folder chosen here has the row's reset, which
 * looks up the one Steam knows about.
 */
export function useGameLinkSettings(): ReadonlyArray<SettingsRow<SettingsCategory>> {
  const rows = useGameLinkRows()
  const pathProblem = useEditor((s) => s.gamePathProblem)
  return rows.map((row) => {
    const { reset } = row
    const problem = pathProblem !== null && pathProblem.which === chosenFolder(row) ? pathProblem.message : null
    return {
      id: `game-${row.id}`,
      category: "game",
      icon: <StateIcon state={problem === null ? row.state : "missing"} />,
      label: row.label,
      description: problem === null ? row.status : <span className="text-destructive">{problem}</span>,
      info: row.note === null && row.path === null ? undefined : <RowInfo row={row} />,
      keywords: `${KEYWORDS} ${row.title} ${row.note ?? ""} ${row.path ?? ""}`,
      changes: {
        modified: reset !== null,
        reset: () => {
          if (reset !== null) void resetGamePaths([reset])
        }
      },
      control: <RowActions row={row} />
    }
  })
}

/** The rows that are missing, each with what is wrong. Empty when File › Game link… opens with everything found. */
export function MissingGameLinkRows() {
  const missing = useGameLinkRows().filter((row) => row.state === "missing")
  if (missing.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {missing.map((row) => (
        <li key={row.id} className="flex items-start gap-2">
          <StateIcon state={row.state} />
          <div className="flex min-w-0 flex-col">
            <span className="text-body-strong">{row.label}</span>
            <span className="text-caption text-fg-tertiary">{row.title}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Looks the folders, the plugin and the creator up again. */
export function CheckAgainButton() {
  return (
    <Button variant="secondary" onClick={() => void refreshGameLink()}>
      <IconRefresh data-icon="inline-start" />
      Check again
    </Button>
  )
}
