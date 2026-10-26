import { IconCamera, IconKeyboard, IconPalette, IconSearch, IconSettings } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Kbd } from "@workspace/ui/components/kbd"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Slider } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import {
  chordOf,
  formatBinding,
  type KeybindAction,
  keybindActionDescriptions,
  keybindActionLabels,
  keybindSections,
  type Keybinds,
  mouseChordOf,
  mouseDragActions,
  wheelChordOf
} from "../domain/Keybinds"
import { CUSTOM_FOV_PRESET, defaultSettings, type Settings } from "../domain/Settings"
import { resetKeybinds, saveKeybinds, saveSettings } from "../editor/actions"
import type { SettingsCategory } from "../editor/commands"
import { useEditor } from "../editor/store"

const CATEGORIES: ReadonlyArray<{ readonly id: SettingsCategory; readonly label: string; readonly icon: typeof IconSettings }> = [
  { id: "general", label: "General", icon: IconSettings },
  { id: "camera", label: "Camera", icon: IconCamera },
  { id: "keybinds", label: "Keybinds", icon: IconKeyboard },
  { id: "appearance", label: "Appearance", icon: IconPalette }
]

/** One searchable setting. `group` is a sub-heading inside the category (keybind sections). */
interface Row {
  readonly id: string
  readonly category: SettingsCategory
  readonly group?: string
  readonly label: string
  readonly description?: string
  readonly control: ReactNode
}

const wheelActions: ReadonlySet<KeybindAction> = new Set(["speedFaster", "speedSlower"])

function RowView({ row, tooltip }: { readonly row: Row; readonly tooltip: boolean }) {
  const label = <span className="text-xs font-medium">{row.label}</span>
  return (
    <div className="flex min-h-9 items-center gap-4 py-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {tooltip && row.description !== undefined
          ? (
            <Tooltip>
              <TooltipTrigger render={<span className="w-fit cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-4" />}>
                {label}
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">{row.description}</TooltipContent>
            </Tooltip>
          )
          : label}
        {!tooltip && row.description !== undefined && <span className="text-[0.7rem] text-muted-foreground">{row.description}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{row.control}</div>
    </div>
  )
}

/** Desktop-style settings: category nav on the left, searchable rows on the right. */
export function SettingsDialog(props: {
  readonly open: boolean
  readonly category: SettingsCategory
  readonly onCategoryChange: (category: SettingsCategory) => void
  readonly onClose: () => void
}) {
  const settings = useEditor((s) => s.settings)
  const keybinds = useEditor((s) => s.keybinds)
  const naming = useEditor((s) => s.keybindDefaults.naming)
  const sectionOrder = useEditor((s) => s.keybindDefaults.sectionOrder)
  const cameraPresets = useEditor((s) => s.keybindDefaults.cameraPresets)
  const [query, setQuery] = useState("")
  const [listening, setListening] = useState<KeybindAction | null>(null)

  const update = <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) =>
    void saveSettings({ ...settings, [section]: { ...settings[section], ...patch } })

  // Rebinding: the next key / mouse button / wheel step becomes the binding (Esc cancels).
  useEffect(() => {
    if (listening === null) return
    const assign = (binding: string) => {
      const next: Keybinds = { ...keybinds, [listening]: binding }
      setListening(null)
      void saveKeybinds(next)
    }
    const stop = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const onKey = (e: KeyboardEvent) => {
      stop(e)
      if (e.code === "Escape") setListening(null)
      else if (!mouseDragActions.has(listening)) assign(chordOf(e))
    }
    const onMouse = (e: MouseEvent) => {
      if (!mouseDragActions.has(listening)) return
      stop(e)
      assign(mouseChordOf(e))
    }
    const onWheel = (e: WheelEvent) => {
      if (!wheelActions.has(listening)) return
      stop(e)
      assign(wheelChordOf(e))
    }
    window.addEventListener("keydown", onKey, { capture: true })
    window.addEventListener("mousedown", onMouse, { capture: true })
    window.addEventListener("wheel", onWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true })
      window.removeEventListener("mousedown", onMouse, { capture: true })
      window.removeEventListener("wheel", onWheel, { capture: true })
    }
  }, [listening, keybinds])

  const rows = useMemo((): ReadonlyArray<Row> => {
    const counts = new Map<string, number>()
    for (const binding of Object.values(keybinds)) if (binding !== "") counts.set(binding, (counts.get(binding) ?? 0) + 1)
    const prompt = (action: KeybindAction) =>
      mouseDragActions.has(action) ? "Press a mouse button…" : wheelActions.has(action) ? "Press a key or scroll…" : "Press a key…"

    // Sections and labels: keybinds.json naming when the extractor provides it, else our table.
    const sectionOf = (action: KeybindAction, fallback: string) => naming.get(action)?.section ?? fallback
    const tableOrder: ReadonlyArray<string> = keybindSections.map((s) => s.name)
    const sectionRank = (name: string) => {
      const game = sectionOrder.indexOf(name)
      if (game >= 0) return game
      const ours = tableOrder.indexOf(name)
      return sectionOrder.length + (ours >= 0 ? ours : tableOrder.length)
    }
    const keybindRows = keybindSections.flatMap((section) =>
      section.actions.map((action): Row => ({
        id: `key-${action}`,
        category: "keybinds",
        group: sectionOf(action, section.name),
        label: naming.get(action)?.label ?? keybindActionLabels[action],
        description: keybindActionDescriptions[action],
        control: (
          <Button
            variant={(counts.get(keybinds[action]) ?? 0) > 1 ? "destructive" : "outline"}
            size="sm"
            className="w-44 justify-center"
            onClick={() => setListening(action)}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`Rebind ${keybindActionLabels[action]}`}
          >
            {listening === action ? prompt(action) : <Kbd>{formatBinding(keybinds[action])}</Kbd>}
          </Button>
        )
      }))
    ).map((row, i) => ({ row, i }))
      // game sections in the game's settings-screen order, then the editor's own
      .sort((x, y) => sectionRank(x.row.group ?? "") - sectionRank(y.row.group ?? "") || x.i - y.i)
      .map(({ row }) => row)

    const c = settings.camera
    const presetItems: Record<string, string> = Object.fromEntries([
      ...cameraPresets.map((p) => [p.id, `${p.label} (fov ${p.fov})`]),
      [CUSTOM_FOV_PRESET, `Custom (fov ${c.customFov})`]
    ])
    const a = settings.appearance
    return [
      {
        id: "units",
        category: "general",
        label: "Units",
        description: "How positions are shown in the inspector. Map files always store centimetres.",
        control: (
          <Select
            value={settings.general.units}
            items={{ cm: "Centimetres", m: "Metres" }}
            onValueChange={(v) => update("general", { units: v as "cm" | "m" })}
          >
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cm">Centimetres</SelectItem>
              <SelectItem value="m">Metres</SelectItem>
            </SelectContent>
          </Select>
        )
      },
      {
        id: "autosave",
        category: "general",
        label: "Autosave",
        description: "Coming later.",
        control: <Switch disabled checked={false} />
      },
      {
        id: "fov",
        category: "camera",
        label: "Field of view",
        description: "The game's camera presets (from its camera settings). Only the field of view applies to the editor.",
        control: (
          <Select value={c.fovPreset} items={presetItems} onValueChange={(v) => update("camera", { fovPreset: String(v) })}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(presetItems).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        )
      },
      {
        id: "customFov",
        category: "camera",
        label: "Custom field of view",
        description: "Horizontal degrees, used when the preset is Custom (like the game).",
        control: (
          <>
            <Slider
              className="w-48"
              min={30}
              max={140}
              step={1}
              value={c.customFov}
              disabled={c.fovPreset !== CUSTOM_FOV_PRESET}
              onValueChange={(v) => update("camera", { customFov: v as number })}
            />
            <span className="w-20 text-right font-mono text-xs tabular-nums">{c.customFov}°</span>
          </>
        )
      },
      {
        id: "flySpeed",
        category: "camera",
        label: "Fly speed",
        description: "Base camera speed. Camera speed up/down multiply it.",
        control: (
          <>
            <Slider className="w-48" min={100} max={20000} step={100} value={c.flySpeed} onValueChange={(v) => update("camera", { flySpeed: v as number })} />
            <span className="w-20 text-right font-mono text-xs tabular-nums">{(c.flySpeed / 100).toFixed(0)} m/s</span>
          </>
        )
      },
      {
        id: "lookSensitivity",
        category: "camera",
        label: "Look sensitivity",
        control: (
          <>
            <Slider className="w-48" min={0.1} max={5} step={0.1} value={c.lookSensitivity} onValueChange={(v) => update("camera", { lookSensitivity: v as number })} />
            <span className="w-20 text-right font-mono text-xs tabular-nums">×{c.lookSensitivity.toFixed(1)}</span>
          </>
        )
      },
      {
        id: "invertX",
        category: "camera",
        label: "Invert look horizontal",
        control: <Switch checked={c.invertLookX} onCheckedChange={(v) => update("camera", { invertLookX: v })} />
      },
      {
        id: "invertY",
        category: "camera",
        label: "Invert look vertical",
        control: <Switch checked={c.invertLookY} onCheckedChange={(v) => update("camera", { invertLookY: v })} />
      },
      ...keybindRows,
      {
        id: "theme",
        category: "appearance",
        label: "Theme",
        control: (
          <Select
            value={a.theme}
            items={{ dark: "Dark", light: "Light", system: "System" }}
            onValueChange={(v) => update("appearance", { theme: v as Settings["appearance"]["theme"] })}
          >
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        )
      },
      {
        id: "gridVisible",
        category: "appearance",
        label: "Show grid",
        control: <Switch checked={a.gridVisible} onCheckedChange={(v) => update("appearance", { gridVisible: v })} />
      },
      {
        id: "gridCell",
        category: "appearance",
        label: "Grid colour (1 m cells)",
        control: <Input type="color" className="h-7 w-14 p-0.5" value={a.gridCellColor} onChange={(e) => update("appearance", { gridCellColor: e.target.value })} />
      },
      {
        id: "gridSection",
        category: "appearance",
        label: "Grid colour (10 m sections)",
        control: <Input type="color" className="h-7 w-14 p-0.5" value={a.gridSectionColor} onChange={(e) => update("appearance", { gridSectionColor: e.target.value })} />
      }
    ]
  }, [settings, keybinds, naming, sectionOrder, cameraPresets, listening])

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
  const searching = terms.length > 0
  const visible = searching
    ? rows.filter((r) => terms.every((t) => `${r.label} ${r.description ?? ""} ${r.group ?? ""} ${r.category}`.toLowerCase().includes(t)))
    : rows.filter((r) => r.category === props.category)

  // Group: by category when searching, then by sub-group (keybind sections).
  const groups: Array<{ key: string; title: string | undefined; rows: Array<Row> }> = []
  for (const row of visible) {
    const title = searching
      ? [CATEGORIES.find((c) => c.id === row.category)?.label, row.group].filter(Boolean).join(" › ")
      : row.group
    const last = groups.at(-1)
    if (last !== undefined && last.title === title) last.rows.push(row)
    else groups.push({ key: `${row.category}-${title ?? ""}`, title, rows: [row] })
  }

  const current = CATEGORIES.find((c) => c.id === props.category)!
  const resetCurrent = () => {
    if (props.category === "keybinds") void resetKeybinds()
    else if (props.category === "general") void saveSettings({ ...settings, general: defaultSettings.general })
    else if (props.category === "camera") void saveSettings({ ...settings, camera: defaultSettings.camera })
    else void saveSettings({ ...settings, appearance: defaultSettings.appearance })
  }

  return (
    <Dialog open={props.open} onOpenChange={(next) => !next && listening === null && props.onClose()}>
      <DialogContent className="flex h-[min(80vh,720px)] w-full gap-0 overflow-hidden p-0 sm:max-w-4xl" showCloseButton>
        <nav className="flex w-56 shrink-0 flex-col gap-1 border-r bg-muted/30 p-3">
          <div className="relative mb-2">
            <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-7" placeholder="Search settings" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search settings" />
          </div>
          {CATEGORIES.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={!searching && props.category === id ? "secondary" : "ghost"}
              className="justify-start"
              onClick={() => {
                setQuery("")
                props.onCategoryChange(id)
              }}
              data-category={id}
            >
              <Icon /> {label}
            </Button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b px-5 py-3">
            <DialogTitle>{searching ? `Search: ${query}` : current.label}</DialogTitle>
            <DialogDescription className="sr-only">Editor settings</DialogDescription>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 px-5 py-3">
              {groups.map((group) => (
                <section key={group.key} className="flex flex-col">
                  {group.title !== undefined && group.title !== "" && (
                    <h3 className="mb-1 text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase">{group.title}</h3>
                  )}
                  <div className="flex flex-col divide-y divide-border/50">
                    {group.rows.map((row) => <RowView key={row.id} row={row} tooltip={row.category === "keybinds"} />)}
                  </div>
                </section>
              ))}
              {groups.length === 0 && <p className="text-xs text-muted-foreground">No settings match.</p>}
            </div>
          </ScrollArea>
          <div className="flex justify-between border-t px-5 py-3">
            <Button variant="outline" onClick={resetCurrent} disabled={searching}>Reset {current.label.toLowerCase()} to defaults</Button>
            <Button onClick={props.onClose} disabled={listening !== null}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
