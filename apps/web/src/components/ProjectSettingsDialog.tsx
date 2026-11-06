import {
  IconAlertTriangleFilled,
  IconCheck,
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
import { Slider, sliderValue } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { Toggle } from "@workspace/ui/components/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { usableCreatorName } from "../domain/creator"
import { isValidName, mapFileNameOf, mapLabelOf, NAME_RULE_SENTENCE } from "../domain/factory"
import type { LevelData } from "../domain/MapFile"
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
import { lastSegmentOf } from "../domain/paths"
import { isProjectName } from "../domain/project"
import {
  EMPTY_BUFFER,
  entryOf,
  hasUnsaved,
  type MapDraft,
  type MapEntryId,
  OPEN_UNSAVED,
  type SavedMapValues,
  type SettingsBuffer,
  unsavedPagesOf,
  unsavedTabEntry,
  withMapDraft,
  withMapEdit,
  withProjectName
} from "../domain/settingsBuffer"
import {
  chooseProject,
  type ProjectMapSettings,
  readProjectMapSettings,
  revealGamePath,
  revealProject,
  saveProjectSettings
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
import { CopyPathAction, PathAction } from "./PathText"
import { type SettingsCategoryInfo, type SettingsRow, SettingsShell } from "./SettingsShell"
import { ConfirmDialog } from "./TitledDialog"

/**
 * The dialog's pages (docs/PROJECTS.md § Shell): the project, then one entry per map (`MapEntryId`). The map whose rows
 * are showing has a second page nested under it, `workshop:` in place of `map:`.
 */
type Category = "project" | MapEntryId | `workshop:${string}`
type Row = SettingsRow<Category>

const UNSAVED_TAB = unsavedTabEntry("")
const unsavedLabelOf = (name: string) => `${name} (unsaved)`
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

/** Its bars, or its sign: in the difficulty's colours when `filled`, greyed when it is only one of the choices. */
function DifficultyIcon({ difficulty, filled }: { readonly difficulty: Difficulty; readonly filled: boolean }) {
  if (difficulty === "baller") {
    return <IconAlertTriangleFilled className={cn("size-3", filled ? "text-difficulty-5" : "text-fg-tertiary")} />
  }
  const bars = DIFFICULTIES.findIndex((d) => d.tag === difficulty) + 1
  return (
    <span className="flex gap-px" aria-hidden>
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={cn(
            "h-3 w-1 rounded-full",
            bar > bars ? "bg-fg-tertiary/30" : filled ? BAR_COLORS[difficulty] : "bg-fg-tertiary"
          )}
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

const LAST_DIFFICULTY = DIFFICULTIES.length - 1

/** Half the slider's thumb, which stops that far inside each end of its track: a stop has to sit under its centre. */
const THUMB_RADIUS = "0.4375rem"

/**
 * The game's five difficulties are ordered, so one track with a stop for each, its icon and name under it. Dragging,
 * the arrow keys and a click on a stop all pick one. A map with no difficulty yet has no thumb until one is picked.
 */
function DifficultySlider(
  { value, onChange }: { readonly value: Difficulty | undefined; readonly onChange: (d: Difficulty) => void }
) {
  const selected = DIFFICULTIES.findIndex((d) => d.tag === value)
  return (
    <div className="max-w-lg px-7">
      <Slider
        aria-label="Difficulty"
        className={cn(selected < 0 && "[&_[data-slot=slider-range]]:hidden [&_[data-slot=slider-thumb]]:opacity-0")}
        min={0}
        max={LAST_DIFFICULTY}
        step={1}
        value={[Math.max(selected, 0)]}
        getAriaValueText={(_, stop) => selected < 0 ? "Not set" : DIFFICULTIES[stop]?.level ?? ""}
        onValueChange={(next) => {
          const picked = DIFFICULTIES[sliderValue(next) ?? selected]
          if (picked !== undefined && picked.tag !== value) onChange(picked.tag)
        }}
      />
      <div className="relative mt-2 h-14">
        {DIFFICULTIES.map((d, index) => (
          <Tooltip key={d.tag}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  // the slider's thumb is the one tab stop; its arrow keys walk these
                  tabIndex={-1}
                  aria-pressed={index === selected}
                  className={cn(
                    "absolute top-0 flex w-max -translate-x-1/2 flex-col items-center gap-1 rounded-control px-2 pt-1 pb-1.5 text-caption transition-colors",
                    index === selected
                      ? "bg-primary/12 text-foreground"
                      : "text-fg-tertiary hover:bg-foreground/6 hover:text-fg-secondary"
                  )}
                  style={{
                    left: `calc(${THUMB_RADIUS} + (100% - 2 * ${THUMB_RADIUS}) * ${index / LAST_DIFFICULTY})`
                  }}
                  onClick={() => {
                    if (index !== selected) onChange(d.tag)
                  }}
                />
              }
            >
              <DifficultyIcon difficulty={d.tag} filled={index === selected} />
              {d.level}
            </TooltipTrigger>
            <TooltipContent side="bottom">{DIFFICULTY_TIPS[d.tag]}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
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
            className="rounded-full bg-muted px-3 text-fg-secondary transition-colors hover:lift-muted active:press-muted aria-pressed:bg-selected aria-pressed:text-foreground aria-pressed:hover:lift-selected aria-pressed:active:press-selected"
          >
            {on && <IconCheck data-icon="inline-start" />}
            {tag}
          </Toggle>
        )
      })}
    </div>
  )
}

/**
 * A map's name, buffered as it is typed. A name that can't be used goes back to the saved one when the field is left;
 * Escape puts the saved one back at once, and only then closes the dialog.
 */
function NameInput(
  { value, saved, problemWith, onChange }: {
    readonly value: string
    readonly saved: string
    /** What's wrong with a name, or null when it can be used. */
    readonly problemWith: (name: string) => string | null
    readonly onChange: (name: string) => void
  }
) {
  const problem = value === saved ? null : problemWith(value)
  return (
    <Input
      className="w-56"
      value={value}
      aria-label="Map name"
      aria-invalid={problem !== null}
      title={problem ?? undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        if (problem !== null) onChange(saved)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape" && value !== saved) {
          e.stopPropagation() // just the edit, not the dialog
          onChange(saved)
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

const REVEAL = "Reveal in folder"

const mapCategory = (id: Category, label: string): SettingsCategoryInfo<Category> => ({
  id,
  label,
  icon: IconMap,
  section: "Maps"
})

/** A map entry: what it is called, and what it has saved, which the dialog's buffer sits on top of. */
interface MapEntry extends SavedMapValues {
  readonly category: MapEntryId
  readonly label: string
  /** The map's file in the project; null for the open map while it has none yet. */
  readonly fileName: string | null
}

const useOpenMapEntry = (): MapEntry => {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const exportOnSave = useEditor((s) => s.exportOnSave)
  const fileName = useEditor((s) => s.file?.name ?? null)
  return {
    category: fileName === null ? OPEN_UNSAVED : entryOf(fileName),
    label: fileName === null ? unsavedLabelOf(levelData.levelDisplayName.trim() || "Untitled") : mapLabelOf(fileName),
    fileName,
    levelData,
    exportOnSave
  }
}

/** A map open in a tab that isn't the active one. */
const useTabMapEntry = (tabId: string | null): MapEntry | null => {
  const tab = useEditor((s) => tabId === null ? undefined : tabStateOf(s, tabId))
  if (tabId === null || tab === undefined) return null
  const { file } = tab
  return {
    category: file === null ? unsavedTabEntry(tabId) : entryOf(file.name),
    label: file === null ? unsavedLabelOf(tabLabelOf(tab)) : mapLabelOf(file.name),
    fileName: file?.name ?? null,
    levelData: tab.doc.map.worldSettings.levelData,
    exportOnSave: tab.exportOnSave
  }
}

/**
 * A map that isn't open, read from its file when its entry shows, again when the file changes and after each Save
 * (`revision`: Export on save changes only its prefs); null until read.
 */
const useDiskMapEntry = (
  fileName: string | null,
  modifiedAt: string | undefined,
  revision: number
): MapEntry | null => {
  const [read, setRead] = useState<{ readonly fileName: string; readonly settings: ProjectMapSettings } | null>(null)
  // read again when the file changes on disk (`modifiedAt`), not only when another entry shows; a map gone from the
  // list has no file to read (a rename drops it there just before the entry moves on)
  const version = fileName === null || modifiedAt === undefined ? null : `${fileName}\n${modifiedAt}\n${revision}`
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
  return {
    category: entryOf(fileName),
    label: mapLabelOf(fileName),
    fileName,
    levelData: map.worldSettings.levelData,
    exportOnSave: prefs.exportOnSave === true
  }
}

/** The rows of one map's entry. Its Map page holds what is the map's in this editor, its Workshop page what publishing shows. */
const mapRows = (
  entry: MapEntry,
  draft: MapDraft | undefined,
  options: {
    readonly savedCreator: string
    readonly canExport: boolean
    readonly maps: ReadonlyArray<ProjectMap>
    readonly edit: (edit: MapDraft) => void
  }
): ReadonlyArray<Row> => {
  const { category } = entry
  const { maps, edit } = options
  const levelData = withMapDraft(entry.levelData, draft, options.savedCreator)
  const { creatorName: creator } = levelData
  const editWorkshop = ({ levelDifficulty, mapTags }: LevelData) => edit({ workshop: { levelDifficulty, mapTags } })
  const difficulty = difficultyOf(levelData)
  const others = unknownTags(levelData)
  const path = maps.find((m) => m.fileName === entry.fileName)?.path
  const workshop = workshopPageOf(category)
  const problemWith = (name: string) => {
    if (!isValidName(name)) return `${NAME_RULE_SENTENCE}.`
    const target = mapFileNameOf(name, (creator || options.savedCreator) || "creator")
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
          saved={entry.levelData.levelDisplayName}
          problemWith={problemWith}
          onChange={(name) => edit({ name })}
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
          control: (
            <Switch
              checked={draft?.exportOnSave ?? entry.exportOnSave}
              onCheckedChange={(exportOnSave) => edit({ exportOnSave })}
            />
          )
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
      control: <DifficultySlider value={difficulty} onChange={(d) => editWorkshop(withDifficulty(levelData, d))} />
    },
    ...TAG_GROUPS.map((group): Row => {
      const names = group.tags.map((tag) => tagNameOf(group.group, tag))
      const chosen = names.filter((tag) => hasTag(levelData, tag)).length
      return {
        id: `tags-${group.group}`,
        category: workshop,
        label: `${group.group} · ${chosen} of ${names.length}`,
        description: TAG_DESCRIPTIONS[group.group],
        keywords: `${entry.label} tags ${group.tags.join(" ")}`,
        wide: true,
        action: chosen > 0 && (
          <Button
            variant="link"
            size="xs"
            onClick={() => editWorkshop(names.reduce((l, tag) => withTag(l, tag, false), levelData))}
          >
            Clear
          </Button>
        ),
        control: <TagChips group={group} levelData={levelData} onChange={editWorkshop} />
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
            {others.map((tag) => <Badge key={tag} className={CHIP}>{tag}</Badge>)}
          </div>
        )
      } satisfies Row
    ])
  ]
}

/**
 * The project's name, buffered as it is typed; leaving the field blank or with a name that can't be used puts the saved
 * one back. Saving it renames a named project in its file, and names Untitled Project (`saved` null), making its folder.
 */
function ProjectNameField(
  { value, saved, onChange }: {
    readonly value: string
    readonly saved: string | null
    readonly onChange: (name: string) => void
  }
) {
  const trimmed = value.trim()
  const valid = trimmed === "" || isProjectName(trimmed)
  return (
    <Input
      className="w-56"
      value={value}
      placeholder={saved === null ? "Untitled Project" : undefined}
      aria-label="Project name"
      aria-invalid={!valid}
      title={valid ? undefined : "Letters, digits, spaces, - and _ only."}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onChange(valid && trimmed !== "" ? trimmed : saved ?? "")}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
    />
  )
}

/**
 * Project settings (docs/PROJECTS.md § Shell), one dialog in IntelliJ's Project Structure shape: the project (name,
 * folders), then an entry per map (name, file, Export on save), and for the map showing a Workshop page nested under
 * it (difficulty, tags). Edits wait in a buffer (`domain/settingsBuffer.ts`), each page they touch with a dot, until Save
 * writes them all: a map in a tab as one undo step there, any other map to its file. Revert drops them, and leaving with
 * any asks first. Project › Project settings… opens on the project (`page` "project"); the open map's settings open on
 * its entry ("openMap").
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
  const [buffer, setBuffer] = useState<SettingsBuffer>(EMPTY_BUFFER)
  const [saving, setSaving] = useState(false)
  /** Counts the Saves, so a map read from its file is read again after one. */
  const [revision, setRevision] = useState(0)
  /** What to do once the question about unsaved edits is answered; null while none is asked. */
  const [leaving, setLeaving] = useState<{ readonly next: () => void } | null>(null)
  // Each time the dialog opens, or is opened again for the other page, start on the page it was opened for.
  const opened = open ? page : null
  const [wasOpened, setWasOpened] = useState(opened)
  if (opened !== wasOpened) {
    setWasOpened(opened)
    if (opened !== null) setCategory(opened === "project" && projects ? "project" : openMap.category)
    setBuffer(EMPTY_BUFFER)
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
    revision
  )
  const entry = shownFile === null && shownUnsaved === null ? openMap : tabMap ?? diskMap

  /** Writes the buffer; true when all of it was. What failed stays in the buffer, its dot with it. */
  const save = async () => {
    setSaving(true)
    const saved = await saveProjectSettings(buffer, savedCreator)
    setSaving(false)
    if (saved === undefined) return false
    setBuffer(saved.left)
    setRevision((count) => count + 1)
    const moved = entry === null ? undefined : saved.moved.get(entry.category)
    if (moved !== undefined) {
      setCategory(category.startsWith(WORKSHOP) ? workshopPageOf(entryOf(moved)) : entryOf(moved))
    }
    return !hasUnsaved(saved.left)
  }

  /** Runs `next`, asking first when there is anything unsaved. */
  const leave = (next: () => void) => {
    if (hasUnsaved(buffer)) setLeaving({ next })
    else next()
  }

  // the other tabs' maps with no file yet, which the project's list can't show
  const otherUnsaved = useEditor(useShallow((s) => tabsWithoutFile(s).filter((id) => id !== s.tabId)))
  const otherUnsavedNames = useEditor(useShallow((s) =>
    otherUnsaved.map((id) => {
      const tab = tabStateOf(s, id)
      return tab === undefined ? "Untitled" : tabLabelOf(tab)
    })
  ))
  const mapCategories: ReadonlyArray<SettingsCategoryInfo<Category>> = [
    ...(!inPrefab && (openMap.fileName === null || !projects) ? [mapCategory(openMap.category, openMap.label)] : []),
    ...otherUnsaved.map((tabId, index) =>
      mapCategory(unsavedTabEntry(tabId), unsavedLabelOf(otherUnsavedNames[index] ?? "Untitled"))
    ),
    ...(projects ? maps.map(({ fileName }) => mapCategory(entryOf(fileName), mapLabelOf(fileName))) : [])
  ]
  // a Workshop page is listed only under the map showing, so another map's unsaved one marks that map's entry
  const unsaved = new Set<Category>(buffer.projectName === undefined ? [] : ["project"])
  for (const [id, draft] of buffer.maps) {
    const pages = unsavedPagesOf(draft)
    if (pages.map || (pages.workshop && id !== entry?.category)) unsaved.add(id)
    if (pages.workshop) unsaved.add(workshopPageOf(id))
  }

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
      onClick={() =>
        leave(() => {
          onClose()
          void chooseProject()
        })}
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
      control: (
        <ProjectNameField
          value={buffer.projectName ?? project?.name ?? ""}
          saved={project?.name ?? null}
          onChange={(name) => setBuffer((b) => withProjectName(b, name, project?.name ?? null))}
        />
      )
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
    ...(entry === null ? [] : mapRows(entry, buffer.maps.get(entry.category), {
      savedCreator,
      canExport,
      maps,
      edit: (edit) => setBuffer((b) => withMapEdit(b, entry.category, entry, edit))
    }))
  ]

  // a Workshop page's nav entry only says Workshop, so the heading says whose
  const onWorkshop = category.startsWith(WORKSHOP) && entry !== null

  return (
    <SettingsShell
      open={open}
      onClose={() => leave(onClose)}
      title="Project settings"
      crumbs={onWorkshop ? [entry.label] : []}
      description="The project's name and folders; then each map's name, file, difficulty and tags."
      categories={categories}
      category={category}
      onCategoryChange={setCategory}
      rows={rows}
      busy={saving}
      save={{ unsaved, onSave: () => void save(), onRevert: () => setBuffer(EMPTY_BUFFER) }}
    >
      <ConfirmDialog
        open={leaving !== null}
        onClose={() => setLeaving(null)}
        title="Save your changes?"
        description="If you don't save, the changes in these settings are lost."
        alternative={
          <Button
            variant="outline"
            className="sm:mr-auto"
            onClick={() => {
              setLeaving(null)
              setBuffer(EMPTY_BUFFER)
              leaving?.next()
            }}
          >
            Don't save
          </Button>
        }
        confirm={
          <Button
            disabled={saving}
            onClick={() =>
              void save().then((done) => {
                setLeaving(null)
                if (done) leaving?.next()
              })}
          >
            Save
          </Button>
        }
      />
    </SettingsShell>
  )
}
