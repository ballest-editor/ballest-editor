import {
  IconAlertTriangleFilled,
  IconCheck,
  IconCopy,
  IconFolder,
  IconFolderOpen,
  IconFolderSearch,
  IconMap,
  type IconProps,
  IconWorld
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { Toggle } from "@workspace/ui/components/toggle"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { usableCreatorName } from "../domain/creator"
import { setLevelData as setMapLevelData, withLevelNames } from "../domain/edits"
import { isValidName, mapFileNameOf, mapLabelOf, NAME_RULE_SENTENCE } from "../domain/factory"
import type { LevelData } from "../domain/MapFile"
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
import { isProjectName } from "../domain/project"
import {
  chooseProject,
  copyText,
  nameProject,
  patchProjectMap,
  type ProjectMapSettings,
  readProjectMapSettings,
  renameProject,
  revealGamePath,
  revealProject,
  saveProjectMapPrefs,
  setExportOnSave,
  setLevelData
} from "../editor/actions"
import {
  type ProjectMap,
  tabLabelOf,
  tabStateOf,
  tabsWithoutFile,
  tabWithFile,
  useCreator,
  useEditor
} from "../editor/store"
import { CHIP } from "./chipStyle"
import { PathAction } from "./PathText"
import { type SettingsCategoryInfo, type SettingsRow, SettingsShell } from "./SettingsShell"

/**
 * The dialog's pages (docs/PROJECTS.md § Shell): the project, then one entry per map. `map:<file name>` is a map in
 * the project; `map:open` the open map while it has no file yet; `map:tab:<tab id>` another tab's map while it has none.
 * The map whose rows are showing has a second page nested under it, `workshop:` in place of `map:`.
 */
type Category = "project" | `map:${string}` | `workshop:${string}`
type Row = SettingsRow<Category>

const OPEN_UNSAVED: Category = "map:open"
const UNSAVED_TAB = "map:tab:"
const unsavedTabEntry = (tabId: string): Category => `map:tab:${tabId}`
const unsavedLabelOf = (name: string) => `${name} (unsaved)`
const entryOf = (fileName: string): Category => `map:${fileName}`
const WORKSHOP = "workshop:"
const workshopPageOf = (entry: Category): Category => `${WORKSHOP}${entry.slice("map:".length)}`
/** The map entry a page belongs to. */
const entryOfPage = (page: Category): Category =>
  page.startsWith(WORKSHOP) ? `map:${page.slice(WORKSHOP.length)}` : page

const TAG_DESCRIPTIONS: Readonly<Record<TagGroup, string>> = {
  Gameplay: "What playing the map is like.",
  Mood: "The time of day it's set at.",
  Routes: "How many ways there are through it.",
  Props: "Special pieces it uses."
}

/** A Workshop page's icon, indented so its entry reads as a page of the map above it, not as one more map. */
const WorkshopPageIcon = (props: IconProps) => <IconWorld {...props} className="ml-4" />

/** The bar colour per difficulty, easiest first (the `--difficulty-*` tokens); the fifth is a warning sign. */
const BAR_COLORS: Readonly<Record<Exclude<Difficulty, "baller">, string>> = {
  beginner: "bg-difficulty-1",
  medium: "bg-difficulty-2",
  advanced: "bg-difficulty-3",
  expert: "bg-difficulty-4"
}

function DifficultyIcon({ difficulty }: { readonly difficulty: Difficulty }) {
  if (difficulty === "baller") return <IconAlertTriangleFilled className="size-4 text-difficulty-5" />
  const filled = DIFFICULTIES.findIndex((d) => d.tag === difficulty) + 1
  return (
    <span className="flex gap-px" aria-hidden>
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={cn("h-3 w-1 rounded-full", bar <= filled ? BAR_COLORS[difficulty] : "bg-fg-tertiary/30")}
        />
      ))}
    </span>
  )
}

/** What the game calls each difficulty and how it draws it, which the tokens above needn't match. */
const DIFFICULTY_TIPS: Readonly<Record<Difficulty, string>> = {
  beginner: "Beginner: 1 white bar in the game",
  medium: "Medium: 2 green bars in the game",
  advanced: "Advanced: 3 blue bars in the game",
  expert: "Expert: 4 red bars in the game",
  baller: "Baller: a yellow warning sign in the game"
}

/** The game's five difficulties, each with its icon and name; picking the chosen one again keeps it. */
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
    >
      {DIFFICULTIES.map((d) => (
        <Tooltip key={d.tag}>
          <TooltipTrigger
            render={<ToggleGroupItem value={d.tag} className="gap-1.5" />}
          >
            <DifficultyIcon difficulty={d.tag} />
            {d.level}
          </TooltipTrigger>
          <TooltipContent side="bottom">{DIFFICULTY_TIPS[d.tag]}</TooltipContent>
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
            pressed={on}
            onPressedChange={(next) => onChange(withTag(levelData, name, next))}
            className="rounded-full bg-muted px-3 text-fg-secondary transition-colors duration-150 ease-out hover:bg-foreground/10 aria-pressed:bg-primary/12 aria-pressed:text-foreground aria-pressed:hover:bg-primary/20"
          >
            {on && <IconCheck data-icon="inline-start" />}
            {tag}
          </Toggle>
        )
      })}
    </div>
  )
}

/** Commits on Enter or blur when the name can be used; Escape or a name that can't puts the map's back. */
function NameInput(
  { value, problemWith, onCommit }: {
    readonly value: string
    /** What's wrong with a name, or null when it can be used. */
    readonly problemWith: (name: string) => string | null
    readonly onCommit: (name: string) => void
  }
) {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? value
  const problem = text === value ? null : problemWith(text)
  return (
    <Input
      className="w-56"
      value={text}
      aria-label="Map name"
      aria-invalid={problem !== null}
      title={problem ?? undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value && problemWith(draft) === null) onCommit(draft)
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

/** A place as a row shows it: its name, with the whole path on hover. */
function PlaceName({ name, path }: { readonly name: string; readonly path: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="max-w-56 truncate text-body text-fg-secondary" />}>
        {name}
      </TooltipTrigger>
      <TooltipContent className="break-all">{path}</TooltipContent>
    </Tooltip>
  )
}

/** Copies a path; the icon says it worked for a moment. */
function CopyPathAction({ path }: { readonly path: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <PathAction
      label={copied ? "Copied" : "Copy path"}
      icon={copied ? IconCheck : IconCopy}
      onClick={() => void copyText(path).then((done) => setCopied(done === true))}
    />
  )
}

const REVEAL = "Reveal in folder"

/** A path's last segment: the folder a location row names. */
const lastSegmentOf = (path: string) => path.split(/[\\/]/).findLast((segment) => segment !== "") ?? path

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
  readonly exportOnSave: boolean
  readonly setLevelData: (levelData: LevelData) => void
  readonly setExportOnSave: (on: boolean) => void
}

/** The open map, edited in the editor. */
const useOpenMapEntry = (): MapEntry => {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const exportOnSave = useEditor((s) => s.exportOnSave)
  const fileName = useEditor((s) => s.file?.name ?? null)
  return {
    category: fileName === null ? OPEN_UNSAVED : entryOf(fileName),
    label: fileName === null ? unsavedLabelOf(levelData.levelDisplayName.trim() || "Untitled") : mapLabelOf(fileName),
    fileName,
    levelData,
    exportOnSave,
    setLevelData: (next) => void setLevelData(next),
    setExportOnSave: (on) => void setExportOnSave(on)
  }
}

/** A map open in a tab that isn't the active one: edited in that tab (undo steps there, its prefs), like the open map. */
const useTabMapEntry = (tabId: string | null): MapEntry | null => {
  const tab = useEditor((s) => tabId === null ? undefined : tabStateOf(s, tabId))
  if (tabId === null || tab === undefined) return null
  const { file } = tab
  return {
    category: file === null ? unsavedTabEntry(tabId) : entryOf(file.name),
    label: file === null ? unsavedLabelOf(tabLabelOf(tab)) : mapLabelOf(file.name),
    fileName: file?.name ?? null,
    levelData: tab.doc.map.worldSettings.levelData,
    exportOnSave: tab.exportOnSave,
    setLevelData: (next) => void setLevelData(next, tabId),
    setExportOnSave: (on) => void setExportOnSave(on, tabId)
  }
}

/**
 * A map that isn't open, read from its file when its entry shows (and again after each write); null until read. Edits
 * go through the save path, so the file moves when the name changes and the old one goes to the backups; the map's
 * prefs go with it, and `onMoved` gets the new file name.
 */
const useDiskMapEntry = (
  fileName: string | null,
  modifiedAt: string | undefined,
  onMoved: (fileName: string) => void
): MapEntry | null => {
  const [read, setRead] = useState<{ readonly fileName: string; readonly settings: ProjectMapSettings } | null>(null)
  // read again when the file changes on disk (`modifiedAt`), not only when another entry shows; a map gone from the
  // list has no file to read (a rename drops it there just before `onMoved` moves the entry on)
  const version = fileName === null || modifiedAt === undefined ? null : `${fileName}\n${modifiedAt}`
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
  const savePrefs = (next: MapPrefs) => {
    setRead({ fileName, settings: { map, prefs: next } })
    void saveProjectMapPrefs(key, next)
  }
  return {
    category: entryOf(fileName),
    label: mapLabelOf(fileName),
    fileName,
    levelData: map.worldSettings.levelData,
    exportOnSave: prefs.exportOnSave === true,
    setLevelData: (levelData) =>
      void patchProjectMap(fileName, (current) => setMapLevelData(current, levelData)).then((saved) => {
        if (saved === undefined || saved.fileName === fileName) return
        void saveProjectMapPrefs(levelData.userLevelName, prefs)
        onMoved(saved.fileName)
      }),
    setExportOnSave: (on) => {
      const { exportOnSave: _previous, ...rest } = prefs
      savePrefs(on ? { ...rest, exportOnSave: true } : rest)
    }
  }
}

/** The rows of one map's entry. Its Map page holds what is the map's in this editor, its Workshop page what publishing shows. */
const mapRows = (
  entry: MapEntry,
  options: {
    readonly savedCreator: string
    readonly canExport: boolean
    readonly maps: ReadonlyArray<ProjectMap>
  }
): ReadonlyArray<Row> => {
  const { category, levelData } = entry
  const { maps } = options
  // A map made before a creator was saved has none yet; it gets the saved one, as Export would.
  const creator = levelData.creatorName || options.savedCreator
  const difficulty = difficultyOf(levelData)
  const others = unknownTags(levelData)
  const path = maps.find((m) => m.fileName === entry.fileName)?.path
  const workshop = workshopPageOf(category)
  const problemWith = (name: string) => {
    if (!isValidName(name)) return `${NAME_RULE_SENTENCE}.`
    const target = mapFileNameOf(name, creator || "creator")
    return target !== entry.fileName && maps.some((m) => m.fileName === target)
      ? "The project already has a map by that name."
      : null
  }
  return [
    {
      id: "name",
      category,
      label: "Name",
      description: "The file is named after it.",
      control: (
        <NameInput
          value={levelData.levelDisplayName}
          problemWith={problemWith}
          onCommit={(next) => entry.setLevelData(withLevelNames(levelData, next, creator))}
        />
      )
    },
    {
      id: "file",
      category,
      label: "File",
      // no file yet: the description says so, and Save is the way to one
      ...(entry.fileName === null && { description: "Not saved yet." }),
      control: entry.fileName === null
        ? null
        : path === undefined
        ? <span className="text-body text-fg-secondary">{mapLabelOf(entry.fileName)}</span>
        : (
          <>
            <PlaceName name={mapLabelOf(entry.fileName)} path={path} />
            <PathAction label={REVEAL} icon={IconFolderOpen} onClick={() => void revealProject("maps")} />
            <CopyPathAction path={path} />
          </>
        )
    },
    ...(options.canExport
      ? [
        {
          id: "exportOnSave",
          category,
          label: "Export on save",
          description: "Every Save of this map also exports it to the game.",
          control: <Switch checked={entry.exportOnSave} onCheckedChange={(on) => entry.setExportOnSave(on)} />
        } satisfies Row
      ]
      : []),
    {
      id: "difficulty",
      category: workshop,
      label: "Difficulty",
      description: "Easiest to hardest, with the game's icons.",
      keywords: `${entry.label} ${DIFFICULTIES.map((d) => d.level).join(" ")}`,
      wide: true,
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
        category: workshop,
        label: `${group.group} tags`,
        description: TAG_DESCRIPTIONS[group.group],
        keywords: `${entry.label} ${group.tags.join(" ")}`,
        wide: true,
        action: names.some((tag) => hasTag(levelData, tag)) && (
          <Button
            variant="ghost"
            size="xs"
            className="text-fg-secondary"
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
        category: workshop,
        label: "Other tags",
        description: "Tags this editor doesn't know, such as the old ungrouped ones. They are kept as they are.",
        keywords: `${entry.label} ${others.join(" ")}`,
        wide: true,
        control: (
          <div className="flex flex-wrap gap-1">
            {others.map((tag) => <Badge key={tag} variant="neutral" className={CHIP}>{tag}</Badge>)}
          </div>
        )
      } satisfies Row
    ])
  ]
}

/**
 * The project's name, committed when the field is left or Enter pressed; blank keeps the name as it was. For a named
 * project it renames it in its file; for Untitled Project (`name` null) it names one, making its folder.
 */
function ProjectNameField({ name }: { readonly name: string | null }) {
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? name ?? ""
  const trimmed = value.trim()
  const valid = trimmed === "" || isProjectName(trimmed)
  const commit = () => {
    if (valid && trimmed !== "" && trimmed !== name) {
      void (name === null ? nameProject(trimmed) : renameProject(trimmed))
    }
    setDraft(null)
  }
  return (
    <Input
      className="w-56"
      value={value}
      placeholder={name === null ? "Untitled Project" : undefined}
      aria-label="Project name"
      aria-invalid={!valid}
      title={valid ? undefined : "Letters, digits, spaces, - and _ only."}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
    />
  )
}

/**
 * Project settings (docs/PROJECTS.md § Shell), one dialog in IntelliJ's Project Structure shape: the project (name,
 * folders), then an entry per map (name, file, Export on save), and for the map showing a Workshop page nested under
 * it (difficulty, tags). Edits apply as they are made: the open map's as undo steps in the editor, any other map's to its
 * file. Project › Project settings… opens on the project (`page` "project"); the open map's settings open on its entry
 * ("openMap").
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
  const projectsFolder = useEditor((s) => s.project?.projectsFolder ?? "Documents/Ballest Editor")
  const maps = useEditor((s) => s.projectMaps)
  const creator = useCreator()
  const gameMapsFolder = useEditor((s) => s.gamePaths?.mapsFolder.path ?? null)
  const savedCreator = usableCreatorName(creator)
  const openMap = useOpenMapEntry()
  const inPrefab = useEditor((s) => s.document.kind === "prefab")

  const [category, setCategory] = useState<Category>(openMap.category)
  // Each time the dialog opens, or is opened again for the other page, start on the page it was opened for.
  const opened = open ? page : null
  const [wasOpened, setWasOpened] = useState(opened)
  if (opened !== wasOpened) {
    setWasOpened(opened)
    if (opened !== null) setCategory(opened === "project" && projects ? "project" : openMap.category)
  }

  // the shown entry's map, when it isn't the open one, is read from its file
  const shown = entryOfPage(category)
  const shownUnsaved = shown.startsWith(UNSAVED_TAB) ? shown.slice(UNSAVED_TAB.length) : null
  const shownFile = shownUnsaved === null && shown.startsWith("map:") && shown !== openMap.category &&
      shown !== OPEN_UNSAVED
    ? shown.slice("map:".length)
    : null
  const shownTab = useEditor((s) => shownUnsaved ?? (shownFile === null ? undefined : tabWithFile(s, shownFile))) ??
    null
  const tabMap = useTabMapEntry(shownTab)
  const diskMap = useDiskMapEntry(
    shownTab === null ? shownFile : null,
    maps.find((m) => m.fileName === shownFile)?.modifiedAt,
    (fileName) => setCategory(entryOf(fileName))
  )
  const entry = shownFile === null && shownUnsaved === null ? openMap : tabMap ?? diskMap

  const mapEntries = maps.map((m) => m.fileName)
  // the other tabs' maps with no file yet, which the project's list can't show
  const otherUnsaved = useEditor(useShallow((s) => tabsWithoutFile(s).filter((id) => id !== s.tabId)))
  const otherUnsavedNames = useEditor(useShallow((s) =>
    otherUnsaved.map((id) => {
      const tab = tabStateOf(s, id)
      return tab === undefined ? "Untitled" : tabLabelOf(tab)
    })
  ))
  const mapCategories: ReadonlyArray<SettingsCategoryInfo<Category>> = [
    ...(!inPrefab && (openMap.fileName === null || !projects)
      ? [{ id: openMap.category, label: openMap.label, icon: IconMap, section: "Maps" }]
      : []),
    ...otherUnsaved.map((tabId, index) => ({
      id: unsavedTabEntry(tabId),
      label: unsavedLabelOf(otherUnsavedNames[index] ?? "Untitled"),
      icon: IconMap,
      section: "Maps"
    })),
    ...(projects
      ? mapEntries.map((fileName) => ({
        id: entryOf(fileName),
        label: mapLabelOf(fileName),
        icon: IconMap,
        section: "Maps"
      }))
      : [])
  ]
  const categories: ReadonlyArray<SettingsCategoryInfo<Category>> = [
    ...(projects ? [{ id: "project" as const, label: "General", icon: IconFolder, section: "Project" }] : []),
    // only the map showing lists its Workshop page, so a long project doesn't double its list
    ...mapCategories.flatMap((info) =>
      info.id === entry?.category
        ? [info, { id: workshopPageOf(info.id), label: "Workshop", icon: WorkshopPageIcon, section: "Maps" }]
        : [info]
    )
  ]

  const folderRow = (
    id: string,
    label: string,
    description: string | undefined,
    path: string | null,
    reveal: () => void,
    extra?: ReactNode
  ): Row => ({
    id,
    category: "project",
    label,
    ...(description !== undefined && { description }),
    group: "Locations",
    control: (
      <>
        {path === null
          ? <span className="text-body text-fg-tertiary">Not found</span>
          : <PlaceName name={lastSegmentOf(path)} path={path} />}
        <PathAction label={REVEAL} icon={IconFolderOpen} disabled={path === null} onClick={reveal} />
        {extra}
      </>
    )
  })

  const openAnotherProject = (
    <PathAction
      label="Open another project…"
      icon={IconFolderSearch}
      onClick={() => {
        onClose()
        void chooseProject()
      }}
    />
  )

  const projectRows: ReadonlyArray<Row> = !projects ? [] : [
    {
      id: "projectName",
      category: "project",
      group: "General",
      label: "Name",
      description: project === null
        ? "Naming the project makes its folder."
        : "Shown in the title bar and Recent projects.",
      control: <ProjectNameField name={project?.name ?? null} />
    },
    // Untitled Project has no folders yet: one line says so, and naming it makes them
    ...(project === null
      ? [
        {
          id: "folder",
          category: "project",
          group: "Locations",
          label: "Project folder",
          keywords: "maps backups",
          control: (
            <>
              <Tooltip>
                <TooltipTrigger render={<span className="text-body text-fg-tertiary" />}>
                  Created when the project is named
                </TooltipTrigger>
                <TooltipContent className="break-all">In {projectsFolder}</TooltipContent>
              </Tooltip>
              {openAnotherProject}
            </>
          )
        } satisfies Row
      ]
      : [
        folderRow(
          "folder",
          "Project folder",
          undefined,
          project.path,
          () => void revealProject("project"),
          openAnotherProject
        ),
        folderRow("mapsFolder", "Maps", undefined, `${project.path}/maps`, () => void revealProject("maps")),
        folderRow(
          "backupsFolder",
          "Backups",
          "Earlier versions of the maps.",
          `${project.path}/.ballest/backups`,
          () => void revealProject("backups")
        )
      ]),
    folderRow(
      "exportsFolder",
      "Exports",
      "The game's maps folder.",
      gameMapsFolder,
      () => void revealGamePath("mapsFolder")
    )
  ]

  // the shown entry's rows (another map's are read from its file when its entry shows), after the project's
  const rows: ReadonlyArray<Row> = [
    ...projectRows,
    ...(entry === null ? [] : mapRows(entry, { savedCreator, canExport, maps }))
  ]

  // a Workshop page's nav entry only says Workshop, so the heading says whose
  const onWorkshop = category.startsWith(WORKSHOP) && entry !== null

  return (
    <SettingsShell
      open={open}
      onClose={onClose}
      title={onWorkshop ? `Project settings › ${entry.label}` : "Project settings"}
      description="The project's name and folders; then each map's name, file, difficulty and tags."
      categories={categories}
      category={category}
      onCategoryChange={setCategory}
      rows={rows}
    />
  )
}
