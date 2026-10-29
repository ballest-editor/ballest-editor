import { IconAlertTriangleFilled, IconRestore } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Toggle } from "@workspace/ui/components/toggle"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useState } from "react"
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
  tagNameOf,
  unknownTags,
  withDifficulty,
  withTag
} from "../domain/mapTags"
import { saveProjectSettings } from "../editor/actions"
import { useEditor } from "../editor/store"
import { NumberField } from "./NumberField"

/** A group as the game's publish screen draws it: a lowercase title after a lime bar, then a framed box. */
function TagSection(
  { title, children }: { readonly title: string; readonly children: ReactNode }
) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-1.5 text-sm leading-none">
        <span className="h-3.5 w-1 rounded-full bg-lime-400" aria-hidden />
        {title}
      </h3>
      <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-muted/40 p-2">{children}</div>
    </section>
  )
}

/** Selected chips fill in; the rest are outlined and dimmed (as in the game). */
const CHIP =
  "border-border text-muted-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:bg-foreground/85 aria-pressed:hover:text-background"

/** The bar colour per difficulty (white, green, blue, red); the fifth is a warning sign. */
const BAR_COLORS: Readonly<Record<Exclude<Difficulty, "baller">, string>> = {
  // white bars turn dark on the selected (light) button
  beginner: "bg-foreground group-aria-pressed/toggle:bg-background",
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
          className={cn(
            "h-3.5 w-1.5 rounded-[2px]",
            bar <= filled ? BAR_COLORS[difficulty] : "bg-muted-foreground/30"
          )}
        />
      ))}
    </span>
  )
}

interface Draft {
  readonly name: string
  readonly levelData: LevelData
  readonly gridHeight: number
}

/**
 * Project settings. A project is one map for now: its name, the editor's grid height for
 * it, and the difficulty and tags the game's publish screen sets. Changes apply on Save, the level fields as one
 * undo step.
 */
export function ProjectSettingsDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const levelData = useEditor((s) => s.doc.map.worldSettings.levelData)
  const floorHeight = useEditor((s) => s.floorHeight)
  const startHeight = useEditor((s) => floorHeightOf(s.doc.map))
  const units = useEditor((s) => s.settings.general.units)
  const savedCreator = useEditor((s) => s.settings.general.creatorName.trim())
  const fresh = (): Draft => ({ name: levelData.levelDisplayName, levelData, gridHeight: floorHeight })
  const [draft, setDraft] = useState(fresh)
  // Each time the dialog opens, start from the map as it is.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(fresh())
  }
  const edit = (f: (levelData: LevelData) => LevelData) => setDraft((d) => ({ ...d, levelData: f(d.levelData) }))

  // A map made before a creator was saved has none yet; it gets the saved one, as Export would.
  const creator = levelData.creatorName || savedCreator
  const perUnit = units === "m" ? 100 : 1
  const difficulty = difficultyOf(draft.levelData)
  const others = unknownTags(draft.levelData)
  const canSave = isValidName(draft.name)

  const save = async () => {
    onClose()
    await saveProjectSettings(withLevelNames(draft.levelData, draft.name, creator), draft.gridHeight)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[min(90svh,52rem)] flex-col gap-0 p-0 sm:max-w-md">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSave) void save()
          }}
        >
          <DialogHeader className="p-4 pb-3">
            <DialogTitle>Project settings</DialogTitle>
            <DialogDescription>
              Exports as{" "}
              <code className="break-all">{mapFileNameOf(draft.name || "name", creator || "creator")}</code>. Difficulty
              and tags are what the game's publish screen shows.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-4 px-4 pb-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="project-map-name">Map name</Label>
                <Input
                  id="project-map-name"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  aria-invalid={!isValidName(draft.name)}
                />
                <span className="text-[0.7rem] text-muted-foreground">{NAME_RULE}</span>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Grid height ({units})</Label>
                <div className="flex items-center gap-2">
                  <div className="w-32">
                    <NumberField
                      label="Grid height"
                      value={draft.gridHeight / perUnit}
                      digits={units === "m" ? 3 : 1}
                      onCommit={(value) => setDraft((d) => ({ ...d, gridHeight: value * perUnit }))}
                    />
                  </div>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={draft.gridHeight === startHeight}
                          onClick={() => setDraft((d) => ({ ...d, gridHeight: startHeight }))}
                        />
                      }
                    >
                      <IconRestore /> Player start
                    </TooltipTrigger>
                    <TooltipContent>Back to the player start's height</TooltipContent>
                  </Tooltip>
                </div>
                <span className="text-[0.7rem] text-muted-foreground">
                  Where the grid is drawn and new pieces land. Saved in this editor for this map, not in the file.
                </span>
              </div>

              <TagSection title="difficulty">
                <ToggleGroup
                  value={difficulty === undefined ? [] : [difficulty]}
                  onValueChange={(value) => {
                    const next = DIFFICULTIES.find((d) => value.includes(d.tag) && d.tag !== difficulty)
                    if (next !== undefined) edit((l) => withDifficulty(l, next.tag)) // clicking the chosen one keeps it
                  }}
                  spacing={1.5}
                  className="w-full"
                >
                  {DIFFICULTIES.map((d) => (
                    <Tooltip key={d.tag}>
                      <TooltipTrigger
                        render={
                          <ToggleGroupItem
                            value={d.tag}
                            variant="outline"
                            aria-label={d.level}
                            className={cn("h-8 flex-1", CHIP)}
                          />
                        }
                      >
                        <DifficultyIcon difficulty={d.tag} />
                      </TooltipTrigger>
                      <TooltipContent>{d.level}</TooltipContent>
                    </Tooltip>
                  ))}
                </ToggleGroup>
              </TagSection>

              {TAG_GROUPS.map(({ group, tags }) => (
                <TagSection key={group} title={group.toLowerCase()}>
                  {tags.map((tag) => {
                    const name = tagNameOf(group, tag)
                    return (
                      <Toggle
                        key={tag}
                        variant="outline"
                        pressed={hasTag(draft.levelData, name)}
                        onPressedChange={(on) => edit((l) => withTag(l, name, on))}
                        className={CHIP}
                      >
                        {tag.toLowerCase()}
                      </Toggle>
                    )
                  })}
                </TagSection>
              ))}

              {others.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[0.7rem] text-muted-foreground">
                    Other tags in the file, kept as they are:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {others.map((name) => <Badge key={name} variant="outline" className="font-mono">{name}</Badge>)}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
          <DialogFooter className="border-t p-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSave}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
