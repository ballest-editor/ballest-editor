import { IconAlertTriangleFilled, IconCheck, IconMap } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { Toggle } from "@workspace/ui/components/toggle"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
import { usableCreatorName } from "../domain/creator"
import { withLevelNames } from "../domain/edits"
import { isValidName, mapFileNameOf, NAME_RULE } from "../domain/factory"
import { floorHeightOf } from "../domain/level"
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
import { setExportOnSave, setGridHeight, setLevelData } from "../editor/actions"
import { useCreator, useEditor } from "../editor/store"
import { NumberField } from "./NumberField"
import { type SettingsCategoryInfo, type SettingsRow, SettingsShell } from "./SettingsShell"

/** The open map's category, under "Maps"; project settings go above it once there are any (#143). */
type MapCategory = "map"

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
  { group, levelData }: { readonly group: (typeof TAG_GROUPS)[number]; readonly levelData: LevelData }
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
            onPressedChange={(next) => void setLevelData(withTag(levelData, name, next))}
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
 * Map settings, laid out like the editor's settings and applied as they change (level
 * fields as undo steps): the open map's name and grid height, Export on save (desktop), and
 * the difficulty and tags the game's publish screen sets.
 */
export function MapSettingsDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const floorHeight = useEditor((s) => s.floorHeight)
  const startHeight = useEditor((s) => floorHeightOf(s.doc.map))
  const units = useEditor((s) => s.settings.general.units)
  const savedCreator = usableCreatorName(useCreator())
  const canExport = useEditor((s) => s.capabilities.exportToGame)
  const exportOnSave = useEditor((s) => s.exportOnSave)
  const [category, setCategory] = useState<MapCategory>("map")
  const categories: ReadonlyArray<SettingsCategoryInfo<MapCategory>> = [
    { id: "map", label: levelData.levelDisplayName, icon: IconMap, section: "Maps" }
  ]

  // A map made before a creator was saved has none yet; it gets the saved one, as Export would.
  const creator = levelData.creatorName || savedCreator
  const perUnit = units === "m" ? 100 : 1
  const difficulty = difficultyOf(levelData)
  const others = unknownTags(levelData)

  const rows: ReadonlyArray<SettingsRow<MapCategory>> = [
    {
      id: "name",
      category: "map",
      group: "General",
      label: "Name",
      description: `Exports as ${mapFileNameOf(levelData.levelDisplayName, creator || "creator")} (${NAME_RULE}).`,
      control: (
        <NameInput
          value={levelData.levelDisplayName}
          onCommit={(name) => void setLevelData(withLevelNames(levelData, name, creator))}
        />
      )
    },
    {
      id: "gridHeight",
      category: "map",
      group: "General",
      label: `Grid height (${units})`,
      description:
        "Where the grid is drawn and new pieces land. Starts at the player start's height. Kept in this editor, not in the map file.",
      action: (
        <Button
          variant="outline"
          size="sm"
          disabled={floorHeight === startHeight}
          onClick={() => void setGridHeight(startHeight)}
        >
          Use player start
        </Button>
      ),
      control: (
        <div className="w-32">
          <NumberField
            label="Grid height"
            value={floorHeight / perUnit}
            digits={units === "m" ? 3 : 1}
            onCommit={(value) => void setGridHeight(value * perUnit)}
          />
        </div>
      )
    },
    ...(canExport
      ? [
        {
          id: "exportOnSave",
          category: "map",
          group: "General",
          label: "Export on save",
          description:
            "Save also exports the map to the game's maps folder, for going back and forth with the in-game editor. Kept in this editor, not in the map file.",
          control: <Switch checked={exportOnSave} onCheckedChange={(on) => void setExportOnSave(on)} />
        } satisfies SettingsRow<MapCategory>
      ]
      : []),
    {
      id: "difficulty",
      category: "map",
      group: "Workshop",
      label: "Difficulty",
      description: difficulty === undefined
        ? "Not set."
        : `${DIFFICULTIES.find((d) => d.tag === difficulty)?.level ?? difficulty}.`,
      keywords: DIFFICULTIES.map((d) => d.level).join(" "),
      control: <DifficultyPicker value={difficulty} onChange={(d) => void setLevelData(withDifficulty(levelData, d))} />
    },
    ...TAG_GROUPS.map((group): SettingsRow<MapCategory> => {
      const names = group.tags.map((tag) => tagNameOf(group.group, tag))
      return {
        id: `tags-${group.group}`,
        category: "map",
        group: "Workshop",
        label: `${group.group} tags`,
        description: TAG_DESCRIPTIONS[group.group],
        keywords: group.tags.join(" "),
        wide: true,
        action: names.some((name) => hasTag(levelData, name)) && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => void setLevelData(names.reduce((l, name) => withTag(l, name, false), levelData))}
          >
            Clear
          </Button>
        ),
        control: <TagChips group={group} levelData={levelData} />
      }
    }),
    ...(others.length === 0 ? [] : [
      {
        id: "tags-other",
        category: "map",
        group: "Workshop",
        label: "Other tags",
        description: "Tags this editor doesn't know, such as the old ungrouped ones. They are kept as they are.",
        keywords: others.join(" "),
        wide: true,
        control: (
          <div className="flex flex-wrap gap-1">
            {others.map((name) => <Badge key={name} variant="outline" className="font-mono">{name}</Badge>)}
          </div>
        )
      } satisfies SettingsRow<MapCategory>
    ])
  ]

  return (
    <SettingsShell
      open={open}
      onClose={onClose}
      title="Map settings"
      description="Settings for the open map: name, grid height, difficulty and tags."
      categories={categories}
      category={category}
      onCategoryChange={setCategory}
      rows={rows}
    />
  )
}
