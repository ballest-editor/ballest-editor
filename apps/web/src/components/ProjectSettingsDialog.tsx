import { IconAlertTriangleFilled, IconCheck, IconFolder, IconMap } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { Toggle } from "@workspace/ui/components/toggle"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useState } from "react"
import { usableCreatorName } from "../domain/creator"
import { setLevelData as setMapLevelData, withLevelNames } from "../domain/edits"
import { isValidName, mapFileNameOf, mapLabelOf, NAME_RULE } from "../domain/factory"
import { floorHeightOf } from "../domain/level"
import { type LevelData, SYSTEM_LEVEL_NAME } from "../domain/MapFile"
import type { MapPrefs } from "../domain/MapPrefs"
import {
  DIFFICULTIES,
  type Difficulty,
  difficultyOf,
  hasTag,
  TAG_GROUPS,
  type TagGroup,
  tagNameOf,
  unknownTags,
  withDifficulty,
  withTag
} from "../domain/mapTags"
import {
  chooseProject,
  nameProjectMap,
  patchProjectMap,
  type ProjectMapSettings,
  readProjectMapSettings,
  revealProject,
  saveProjectMapPrefs,
  setExportOnSave,
  setGridHeight,
  setLevelData,
  updateSettings
} from "../editor/actions"
import { useCreator, useEditor } from "../editor/store"
import { creatorSettingsRow } from "./CreatorSetting"
import { NumberField } from "./NumberField"
import { type SettingsCategoryInfo, type SettingsRow, SettingsShell } from "./SettingsShell"

/**
 * The dialog's pages (docs/PROJECTS.md § Shell): the project, then one entry per map. `map:<file name>` is a map in
 * the project; `map:open` the open map while it has no file yet.
 */
type Category = "project" | `map:${string}`
type Row = SettingsRow<Category>

const OPEN_UNSAVED: Category = "map:open"
const entryOf = (fileName: string): Category => `map:${fileName}`

const TAG_DESCRIPTIONS: Readonly<Record<TagGroup, string>> = {
  Gameplay: "What playing the map is like.",
  Mood: "The time of day it's set at.",
  Routes: "How many ways there are through it.",
  Props: "Special pieces it uses."
}

/** The bar colour per difficulty (white, green, blue, red), as the game draws them; the fifth is a warning sign. */
const BAR_COLORS: Readonly<Record<Exclude<Difficulty, "baller">, string>> = {
  beginner: "bg-foreground",
  medium: "bg-emerald-400",
  advanced: "bg-blue-600",
  expert: "bg-red-600"
}

function DifficultyIcon({ difficulty }: { readonly difficulty: Difficulty }) {
  if (difficulty === "baller") return <IconAlertTriangleFilled className="size-4 text-yellow-400" />
  const filled = DIFFICULTIES.findIndex((d) => d.tag === difficulty) + 1
  return (
    <span className="flex gap-0.5" aria-hidden>
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={cn("h-3.5 w-1.5 rounded-[2px]", bar <= filled ? BAR_COLORS[difficulty] : "bg-muted-foreground/30")}
        />
      ))}
    </span>
  )
}

/** The game's five difficulty icons; picking the chosen one again keeps it. */
function DifficultyPicker(
  { value, onChange }: { readonly value: Difficulty | undefined; readonly onChange: (d: Difficulty) => void }
) {
  return (
    <ToggleGroup
      value={value === undefined ? [] : [value]}
      onValueChange={(next) => {
        const picked = DIFFICULTIES.find((d) => next.includes(d.tag) && d.tag !== value)
        if (picked !== undefined) onChange(picked.tag)
      }}
      spacing={1}
    >
      {DIFFICULTIES.map((d) => (
        <Tooltip key={d.tag}>
          <TooltipTrigger
            render={
              <ToggleGroupItem
                value={d.tag}
                variant="outline"
                aria-label={d.level}
                className="h-8 w-12 aria-pressed:border-primary aria-pressed:bg-primary/15"
              />
            }
          >
            <DifficultyIcon difficulty={d.tag} />
          </TooltipTrigger>
          <TooltipContent>{d.level}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  )
}

function TagChips(
  { group, levelData, onChange }: {
    readonly group: (typeof TAG_GROUPS)[number]
    readonly levelData: LevelData
    readonly onChange: (levelData: LevelData) => void
  }
) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {group.tags.map((tag) => {
        const name = tagNameOf(group.group, tag)
        const on = hasTag(levelData, name)
        return (
          <Toggle
            key={tag}
            variant="outline"
            pressed={on}
            onPressedChange={(next) => onChange(withTag(levelData, name, next))}
            className="rounded-full px-3 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground"
          >
            {on && <IconCheck data-icon="inline-start" />}
            {tag}
          </Toggle>
        )
      })}
    </div>
  )
}

/** Commits on Enter or blur when the name is valid; Escape or an invalid name puts the map's back. */
function NameInput({ value, onCommit }: { readonly value: string; readonly onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? value
  return (
    <Input
      className="w-56"
      value={text}
      aria-invalid={!isValidName(text)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value && isValidName(draft)) onCommit(draft)
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
          e.stopPropagation() // just the edit, not the dialog
          setDraft(null)
        }
      }}
    />
  )
}

/**
 * A map entry's values and how its edits are applied: the open map's through the editor (undo steps, its prefs), any
 * other map's through its file on disk and the prefs kept for it (`patchProjectMap`, `saveProjectMapPrefs`).
 */
interface MapEntry {
  readonly category: Category
  readonly label: string
  /** The map's file in the project; null for the open map while it has none yet. */
  readonly fileName: string | null
  readonly levelData: LevelData
  readonly floorHeight: number
  readonly startHeight: number
  readonly exportOnSave: boolean
  /** Whether the name can be typed in place: the open map's can; a file's name changes through Rename…. */
  readonly renameInline: boolean
  readonly setLevelData: (levelData: LevelData) => void
  readonly setGridHeight: (height: number) => void
  readonly setExportOnSave: (on: boolean) => void
}

/** The open map, edited in the editor. */
const useOpenMapEntry = (): MapEntry => {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const floorHeight = useEditor((s) => s.floorHeight)
  const startHeight = useEditor((s) => floorHeightOf(s.doc.map))
  const exportOnSave = useEditor((s) => s.exportOnSave)
  const fileName = useEditor((s) => s.file?.name ?? null)
  return {
    category: fileName === null ? OPEN_UNSAVED : entryOf(fileName),
    label: fileName === null ? `${levelData.levelDisplayName.trim() || "Untitled"} (unsaved)` : mapLabelOf(fileName),
    fileName,
    levelData,
    floorHeight,
    startHeight,
    exportOnSave,
    renameInline: true,
    setLevelData: (next) => void setLevelData(next),
    setGridHeight: (height) => void setGridHeight(height),
    setExportOnSave: (on) => void setExportOnSave(on)
  }
}

/**
 * A map that isn't open, read from its file when its entry shows (and again after each write); null until read. Edits
 * go through the save path, so the file moves when the name changes and the old one goes to the backups.
 */
const useDiskMapEntry = (fileName: string | null, modifiedAt: string | undefined): MapEntry | null => {
  const [read, setRead] = useState<{ readonly fileName: string; readonly settings: ProjectMapSettings } | null>(null)
  // read again when the file changes on disk (`modifiedAt`), not only when another entry shows
  const version = fileName === null ? null : `${fileName}\n${modifiedAt ?? ""}`
  useEffect(() => {
    if (version === null) return
    const [name] = version.split("\n")
    if (name === undefined) return
    let stale = false
    void readProjectMapSettings(name).then((settings) => {
      if (!stale && settings !== undefined) setRead({ fileName: name, settings })
    })
    return () => {
      stale = true
    }
  }, [version])
  if (fileName === null || read?.fileName !== fileName) return null
  const { map, prefs } = read.settings
  const key = map.worldSettings.levelData.userLevelName
  const startHeight = floorHeightOf(map)
  const savePrefs = (next: MapPrefs) => {
    setRead({ fileName, settings: { map, prefs: next } })
    void saveProjectMapPrefs(key, next)
  }
  return {
    category: entryOf(fileName),
    label: mapLabelOf(fileName),
    fileName,
    levelData: map.worldSettings.levelData,
    floorHeight: prefs.gridHeight ?? startHeight,
    startHeight,
    exportOnSave: prefs.exportOnSave === true,
    renameInline: false,
    setLevelData: (levelData) => void patchProjectMap(fileName, (current) => setMapLevelData(current, levelData)),
    setGridHeight: (height) => {
      const { gridHeight: _previous, ...rest } = prefs
      savePrefs(height === startHeight ? rest : { ...rest, gridHeight: height })
    },
    setExportOnSave: (on) => {
      const { exportOnSave: _previous, ...rest } = prefs
      savePrefs(on ? { ...rest, exportOnSave: true } : rest)
    }
  }
}

/** The rows of one map's entry: what the old Map settings dialog edited, plus Rename… and Duplicate…. */
const mapRows = (
  entry: MapEntry,
  options: { readonly units: "cm" | "m"; readonly savedCreator: string; readonly canExport: boolean },
  name: (mode: "rename" | "duplicate") => void
): ReadonlyArray<Row> => {
  const { category, levelData } = entry
  const { units } = options
  // A map made before a creator was saved has none yet; it gets the saved one, as Export would.
  const creator = levelData.creatorName || options.savedCreator
  const perUnit = units === "m" ? 100 : 1
  const difficulty = difficultyOf(levelData)
  const others = unknownTags(levelData)
  const fileName = mapFileNameOf(levelData.levelDisplayName, creator || "creator")
  return [
    {
      id: "name",
      category,
      group: "General",
      label: "Name",
      description: `Exports as ${fileName} (${NAME_RULE}).`,
      control: entry.renameInline
        ? (
          <NameInput
            value={levelData.levelDisplayName}
            onCommit={(next) => entry.setLevelData(withLevelNames(levelData, next, creator))}
          />
        )
        : <span className="text-xs">{levelData.levelDisplayName}</span>
    },
    {
      id: "file",
      category,
      group: "General",
      label: "File",
      description: entry.fileName === null
        ? "Not saved in the project yet. Save names it."
        : `${entry.fileName}. Rename moves the file; Duplicate saves a copy and goes on editing it.`,
      control: (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => name("rename")}>Rename…</Button>
          <Button variant="outline" size="sm" onClick={() => name("duplicate")}>Duplicate…</Button>
        </div>
      )
    },
    {
      id: "level",
      category,
      group: "General",
      label: "Level",
      description: "The game level every custom map is spawned into.",
      control: <span className="text-xs text-muted-foreground">{SYSTEM_LEVEL_NAME}</span>
    },
    {
      id: "gridHeight",
      category,
      group: "General",
      label: `Grid height (${units})`,
      description:
        "Where the grid is drawn and new pieces land. Starts at the player start's height. Kept in this editor, not in the map file.",
      action: (
        <Button
          variant="outline"
          size="sm"
          disabled={entry.floorHeight === entry.startHeight}
          onClick={() => entry.setGridHeight(entry.startHeight)}
        >
          Use player start
        </Button>
      ),
      control: (
        <div className="w-32">
          <NumberField
            label="Grid height"
            value={entry.floorHeight / perUnit}
            digits={units === "m" ? 3 : 1}
            onCommit={(value) => entry.setGridHeight(value * perUnit)}
          />
        </div>
      )
    },
    ...(options.canExport
      ? [
        {
          id: "exportOnSave",
          category,
          group: "General",
          label: "Export on save",
          description:
            "Save also exports the map to the game's maps folder, for going back and forth with the in-game editor. Kept in this editor, not in the map file.",
          control: <Switch checked={entry.exportOnSave} onCheckedChange={(on) => entry.setExportOnSave(on)} />
        } satisfies Row
      ]
      : []),
    {
      id: "difficulty",
      category,
      group: "Workshop",
      label: "Difficulty",
      description: difficulty === undefined
        ? "Not set."
        : `${DIFFICULTIES.find((d) => d.tag === difficulty)?.level ?? difficulty}.`,
      keywords: DIFFICULTIES.map((d) => d.level).join(" "),
      control: (
        <DifficultyPicker
          value={difficulty}
          onChange={(d) => entry.setLevelData(withDifficulty(levelData, d))}
        />
      )
    },
    ...TAG_GROUPS.map((group): Row => {
      const names = group.tags.map((tag) => tagNameOf(group.group, tag))
      return {
        id: `tags-${group.group}`,
        category,
        group: "Workshop",
        label: `${group.group} tags`,
        description: TAG_DESCRIPTIONS[group.group],
        keywords: group.tags.join(" "),
        wide: true,
        action: names.some((tag) => hasTag(levelData, tag)) && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => entry.setLevelData(names.reduce((l, tag) => withTag(l, tag, false), levelData))}
          >
            Clear
          </Button>
        ),
        control: <TagChips group={group} levelData={levelData} onChange={entry.setLevelData} />
      }
    }),
    ...(others.length === 0 ? [] : [
      {
        id: "tags-other",
        category,
        group: "Workshop",
        label: "Other tags",
        description: "Tags this editor doesn't know, such as the old ungrouped ones. They are kept as they are.",
        keywords: others.join(" "),
        wide: true,
        control: (
          <div className="flex flex-wrap gap-1">
            {others.map((tag) => <Badge key={tag} variant="outline" className="font-mono">{tag}</Badge>)}
          </div>
        )
      } satisfies Row
    ])
  ]
}

/**
 * Project settings (docs/PROJECTS.md § Shell), one dialog in IntelliJ's Project Structure shape: the project (name,
 * folder, creator, export target), then an entry per map holding what Map settings used to edit (name, level, grid
 * height, Export on save, difficulty, tags) plus Rename… and Duplicate…. Edits apply as they are made: the open map's
 * as undo steps in the editor, any other map's to its file. Project › Project settings… opens on the project
 * (`page` "project"); the open map's settings open on its entry ("openMap").
 */
export function ProjectSettingsDialog(
  { open, page, onClose }: {
    readonly open: boolean
    readonly page: "project" | "openMap"
    readonly onClose: () => void
  }
) {
  const projects = useEditor((s) => s.capabilities.projects)
  const canExport = useEditor((s) => s.capabilities.exportToGame)
  const project = useEditor((s) => s.project?.current ?? null)
  const maps = useEditor((s) => s.projectMaps)
  const units = useEditor((s) => s.settings.general.units)
  const creatorSetting = useEditor((s) => s.settings.general.creatorName)
  const found = useEditor((s) => s.foundCreator)
  const creator = useCreator()
  const savedCreator = usableCreatorName(creator)
  const openDialog = useEditor((s) => s.openDialog)
  const openMap = useOpenMapEntry()

  const [category, setCategory] = useState<Category>(openMap.category)
  // Each time the dialog opens, or is opened again for the other page, start on the page it was opened for.
  const opened = open ? page : null
  const [wasOpened, setWasOpened] = useState(opened)
  if (opened !== wasOpened) {
    setWasOpened(opened)
    if (opened !== null) setCategory(opened === "project" && projects ? "project" : openMap.category)
  }

  // the shown entry's map, when it isn't the open one, is read from its file
  const shownFile = category.startsWith("map:") && category !== openMap.category && category !== OPEN_UNSAVED
    ? category.slice("map:".length)
    : null
  const diskMap = useDiskMapEntry(shownFile, maps.find((m) => m.fileName === shownFile)?.modifiedAt)
  const entry = shownFile === null ? openMap : diskMap

  const mapEntries = maps.map((m) => m.fileName)
  const categories: ReadonlyArray<SettingsCategoryInfo<Category>> = [
    ...(projects && project !== null
      ? [{ id: "project" as const, label: project.name, icon: IconFolder, section: "Project" }]
      : []),
    ...(openMap.fileName === null || !projects
      ? [{ id: openMap.category, label: openMap.label, icon: IconMap, section: "Maps" }]
      : []),
    ...(projects
      ? mapEntries.map((fileName) => ({
        id: entryOf(fileName),
        label: mapLabelOf(fileName),
        icon: IconMap,
        section: "Maps"
      }))
      : [])
  ]

  const name = (fileName: string | null, mode: "rename" | "duplicate") => {
    onClose()
    if (fileName === null || fileName === openMap.fileName) openDialog(mode)
    else void nameProjectMap(fileName, mode)
  }

  const projectRows: ReadonlyArray<Row> = project === null ? [] : [
    {
      id: "projectName",
      category: "project",
      label: "Name",
      description: "The project folder's name. Renaming a project comes with New project (0.5).",
      control: <Input className="w-56" value={project.name} readOnly />
    },
    {
      id: "folder",
      category: "project",
      label: "Folder",
      description: "Where the project's maps are. Change… uses another folder as the project from now on.",
      wide: true,
      control: (
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted-foreground"
            title={project.path}
          >
            {project.path}
          </span>
          <Button variant="outline" size="sm" onClick={() => void revealProject()}>Reveal</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onClose()
              void chooseProject()
            }}
          >
            Change…
          </Button>
        </div>
      )
    },
    {
      ...creatorSettingsRow({
        creator,
        setting: creatorSetting,
        found,
        onChange: (creatorName) => void updateSettings("general", { creatorName })
      }),
      category: "project"
    },
    {
      id: "exportTarget",
      category: "project",
      label: "Export to",
      description: "Where Export to game writes the project's maps.",
      control: <span className="text-xs text-muted-foreground">Game's maps folder</span>
    }
  ]

  // the shown entry's rows (another map's are read from its file when its entry shows), after the project's
  const rows: ReadonlyArray<Row> = [
    ...projectRows,
    ...(entry === null ? [] : mapRows(entry, { units, savedCreator, canExport }, (mode) => name(entry.fileName, mode)))
  ]

  return (
    <SettingsShell
      open={open}
      onClose={onClose}
      title="Project settings"
      description="The project: its name, folder, creator and export target; then each map's name, grid height, difficulty and tags."
      categories={categories}
      category={category}
      onCategoryChange={setCategory}
      rows={rows}
    />
  )
}
