import { IconCamera, IconKeyboard, IconPalette, IconPlus, IconRestore, IconSearch, IconSettings, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Kbd } from "@workspace/ui/components/kbd"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Slider } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import {
  type Bindings,
  chordOf,
  formatBinding,
  heldActions,
  isDefaultBinding,
  type KeybindAction,
  keybindActionDescriptions,
  keybindActionLabels,
  keybindSections,
  mouseChordOf,
  mouseDragActions,
  uniqueBindings,
  wheelChordOf
} from "../domain/Keybinds"
import { CUSTOM_FOV_PRESET, defaultSettings, type Settings } from "../domain/Settings"
import { resetKeybinds, saveKeybinds, saveSettings } from "../editor/actions"
import { type SettingsCategory, useEditor } from "../editor/store"

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
  /** Description shown as a hover tooltip on the label instead of under it. */
  readonly tooltip?: boolean
  readonly disabled?: boolean
  /** Differs from its default; `reset` puts it back. */
  readonly modified: boolean
  readonly reset: () => void
  readonly control: ReactNode
}

/** A binding being captured: a fresh slot (`index` = bindings.length) or a replacement. */
interface Listening {
  readonly action: KeybindAction
  readonly index: number
}

function RowView({ row }: { readonly row: Row }) {
  const label = (
    <span className={cn("text-xs font-medium", row.disabled && "text-muted-foreground")}>
      {row.label}
    </span>
  )
  return (
    <div className="group/row relative flex min-h-9 items-center gap-4 py-1 pl-3">
      {row.modified && (
        <Tooltip>
          <TooltipTrigger render={<span className="absolute top-1/2 left-0 size-1.5 -translate-y-1/2 rounded-full bg-primary" aria-label="Changed from default" />} />
          <TooltipContent side="left">Changed from default</TooltipContent>
        </Tooltip>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {row.tooltip && row.description !== undefined
          ? (
            <Tooltip>
              <TooltipTrigger render={<span className="w-fit cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-4" />}>
                {label}
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">{row.description}</TooltipContent>
            </Tooltip>
          )
          : label}
        {!row.tooltip && row.description !== undefined && (
          <span className={cn("text-[0.7rem] text-muted-foreground", row.disabled && "opacity-60")}>{row.description}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.control}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn("size-6 text-muted-foreground", !row.modified && "invisible")}
                onClick={row.reset}
                aria-label="Reset to default"
                tabIndex={row.modified ? 0 : -1}
              />
            }
          >
            <IconRestore className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="left">Reset to default</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * An action's bindings as key caps (hover one to reveal its ×, which slides in), a dashed
 * + cap for a secondary binding, and a capture cap while listening. Caps bound to more
 * than one action of the same kind are marked red.
 */
function KeybindControl(props: {
  readonly action: KeybindAction
  readonly bindings: Bindings
  readonly conflicts: ReadonlySet<string>
  readonly listening: number | null
  readonly onListen: (index: number) => void
  readonly onRemove: (index: number) => void
}) {
  const label = keybindActionLabels[props.action]
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-end gap-1">
      {props.bindings.map((binding, index) =>
        props.listening === index
          ? <CaptureCap key={`capture-${index}`} />
          : (
            <span
              key={binding}
              className={cn(
                "group/cap inline-flex h-6 items-stretch overflow-hidden rounded-md border bg-muted font-mono text-[11px] leading-none text-foreground tabular-nums",
                props.conflicts.has(binding) ? "border-destructive text-destructive" : "border-border"
              )}
              title={props.conflicts.has(binding) ? "Also bound to another action" : undefined}
            >
              <button
                type="button"
                className="flex cursor-pointer items-center justify-center px-2 hover:bg-foreground/5"
                onClick={() => props.onListen(index)}
                aria-label={`Rebind ${label} (${formatBinding(binding)})`}
              >
                <span className={CAP_TEXT}>{formatBinding(binding)}</span>
              </button>
              <button
                type="button"
                className="flex w-0 items-center justify-center overflow-hidden text-muted-foreground transition-[width] duration-150 group-hover/cap:w-5 group-hover/cap:border-l group-hover/cap:border-border hover:bg-destructive/15 hover:text-destructive focus-visible:w-5"
                onClick={() => props.onRemove(index)}
                aria-label={`Unbind ${formatBinding(binding)} from ${label}`}
                tabIndex={-1}
              >
                <IconX className="size-3 shrink-0" />
              </button>
            </span>
          )
      )}
      {props.listening === props.bindings.length
        ? <CaptureCap />
        : (
          <button
            type="button"
            className="inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-md border border-dashed border-border px-1.5 font-mono text-[11px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            onClick={() => props.onListen(props.bindings.length)}
            aria-label={props.bindings.length === 0 ? `Bind ${label}` : `Add a binding for ${label}`}
          >
            <IconPlus className="size-3" />
            {props.bindings.length === 0 && <span className={CAP_TEXT}>Unbound</span>}
          </button>
        )}
    </div>
  )
}

/** Shown in place of the cap being (re)bound: same shape, primary ring, blinking caret. */
/** Trims the line box to the glyphs' cap height (Chrome 133+); older engines fall back to leading-none. */
const CAP_TEXT = "leading-none [text-box:trim-both_cap_alphabetic]"

function CaptureCap() {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-2 font-mono text-[11px] font-medium text-[color-mix(in_oklch,var(--primary),var(--foreground)_45%)]">
      <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
      <span className={CAP_TEXT}>Press a key</span>
    </span>
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
  const defaults = useEditor((s) => s.keybindDefaults)
  const [query, setQuery] = useState("")
  /** While searching, a category narrows the results; null shows every match. */
  const [scope, setScope] = useState<SettingsCategory | null>(null)
  const [listening, setListening] = useState<Listening | null>(null)

  const update = <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) =>
    void saveSettings({ ...settings, [section]: { ...settings[section], ...patch } })
  const resetField = <K extends keyof Settings>(section: K, key: keyof Settings[K]) =>
    update(section, { [key]: defaultSettings[section][key] } as Partial<Settings[K]>)
  const isDefault = <K extends keyof Settings>(section: K, key: keyof Settings[K]) =>
    settings[section][key] === defaultSettings[section][key]

  const setBindings = (action: KeybindAction, bindings: Bindings) =>
    void saveKeybinds({ ...keybinds, [action]: uniqueBindings(bindings) })

  // Capturing: the next key, mouse button or wheel step fills the slot (Esc cancels).
  useEffect(() => {
    if (listening === null) return
    const { action, index } = listening
    const assign = (binding: string) => {
      const next = [...keybinds[action]]
      next[index] = binding
      setListening(null)
      setBindings(action, next)
    }
    const stop = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const onKey = (e: KeyboardEvent) => {
      stop(e)
      if (e.code === "Escape") setListening(null)
      else assign(chordOf(e))
    }
    const onMouse = (e: MouseEvent) => {
      stop(e)
      assign(mouseChordOf(e))
    }
    const onWheel = (e: WheelEvent) => {
      stop(e)
      assign(wheelChordOf(e))
    }
    const onContextMenu = stop
    window.addEventListener("keydown", onKey, { capture: true })
    window.addEventListener("mousedown", onMouse, { capture: true })
    window.addEventListener("mouseup", stop, { capture: true })
    window.addEventListener("click", stop, { capture: true })
    window.addEventListener("contextmenu", onContextMenu, { capture: true })
    window.addEventListener("wheel", onWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true })
      window.removeEventListener("mousedown", onMouse, { capture: true })
      window.removeEventListener("mouseup", stop, { capture: true })
      window.removeEventListener("click", stop, { capture: true })
      window.removeEventListener("contextmenu", onContextMenu, { capture: true })
      window.removeEventListener("wheel", onWheel, { capture: true })
    }
  }, [listening, keybinds])

  const rows = useMemo((): ReadonlyArray<Row> => {
    // A chord is a conflict when two actions of the same kind share it. A fly key doubling
    // as a tool shortcut (W: forward + move mode, as in the game) is fine: it only flies
    // while the look button is held.
    const kinds = new Map<string, Set<string>>()
    for (const [action, bindings] of Object.entries(keybinds) as Array<[KeybindAction, Bindings]>) {
      const kind = heldActions.has(action) ? "held" : mouseDragActions.has(action) ? "drag" : "oneShot"
      for (const b of bindings) {
        const set = kinds.get(`${kind}:${b}`) ?? new Set<string>()
        set.add(action)
        kinds.set(`${kind}:${b}`, set)
      }
    }
    const conflicts = new Set([...kinds].filter(([, actions]) => actions.size > 1).map(([key]) => key.slice(key.indexOf(":") + 1)))

    // Sections and labels: keybinds.json naming when the extractor provides it, else our table.
    const sectionOf = (action: KeybindAction, fallback: string) => defaults.naming.get(action)?.section ?? fallback
    const tableOrder: ReadonlyArray<string> = keybindSections.map((s) => s.name)
    const sectionRank = (name: string) => {
      const ours = tableOrder.indexOf(name)
      if (ours >= 0) return ours
      const game = defaults.sectionOrder.indexOf(name)
      return tableOrder.length + (game >= 0 ? game : defaults.sectionOrder.length)
    }
    const keybindRows = keybindSections.flatMap((section) =>
      section.actions.map((action): Row => ({
        id: `key-${action}`,
        category: "keybinds",
        group: sectionOf(action, section.name),
        label: defaults.naming.get(action)?.label ?? keybindActionLabels[action],
        description: keybindActionDescriptions[action],
        tooltip: true,
        modified: !isDefaultBinding(keybinds, defaults.keybinds, action),
        reset: () => setBindings(action, defaults.keybinds[action]),
        control: (
          <KeybindControl
            action={action}
            bindings={keybinds[action]}
            conflicts={conflicts}
            listening={listening?.action === action ? listening.index : null}
            onListen={(index) => setListening({ action, index })}
            onRemove={(index) => setBindings(action, keybinds[action].filter((_, i) => i !== index))}
          />
        )
      }))
    ).map((row, i) => ({ row, i }))
      .sort((x, y) => sectionRank(x.row.group ?? "") - sectionRank(y.row.group ?? "") || x.i - y.i)
      .map(({ row }) => row)

    const c = settings.camera
    const presetItems: Record<string, string> = Object.fromEntries([
      ...defaults.cameraPresets.map((p) => [p.id, `${p.label} (fov ${p.fov})`]),
      [CUSTOM_FOV_PRESET, `Custom (fov ${c.customFov})`]
    ])
    const a = settings.appearance
    const customFovOff = c.fovPreset !== CUSTOM_FOV_PRESET
    return [
      {
        id: "units",
        category: "general",
        label: "Units",
        description: "How positions are shown in the inspector. Map files always store centimetres.",
        modified: !isDefault("general", "units"),
        reset: () => resetField("general", "units"),
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
        id: "creatorName",
        category: "general",
        label: "Creator name",
        description: "Your in-game name. Written into every exported map and its file name (letters, digits and spaces).",
        modified: !isDefault("general", "creatorName"),
        reset: () => resetField("general", "creatorName"),
        control: (
          <Input
            className="w-56"
            value={settings.general.creatorName}
            placeholder="your in-game name"
            onChange={(e) => update("general", { creatorName: e.target.value })}
          />
        )
      },
      {
        id: "autosave",
        category: "general",
        label: "Autosave",
        description: "Coming later.",
        disabled: true,
        modified: false,
        reset: () => {},
        control: <Switch disabled checked={false} />
      },
      {
        id: "fov",
        category: "camera",
        label: "Field of view",
        description: "The game's camera presets (from its camera settings). Only the field of view applies to the editor.",
        modified: !isDefault("camera", "fovPreset"),
        reset: () => resetField("camera", "fovPreset"),
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
        description: customFovOff ? "Horizontal degrees. Choose the Custom preset to use it." : "Horizontal degrees, used by the Custom preset (like the game).",
        disabled: customFovOff,
        modified: !isDefault("camera", "customFov"),
        reset: () => resetField("camera", "customFov"),
        control: (
          <>
            <Slider
              className="w-48"
              min={30}
              max={140}
              step={1}
              value={c.customFov}
              disabled={customFovOff}
              onValueChange={(v) => update("camera", { customFov: v as number })}
            />
            <span className={cn("w-20 text-right font-mono text-xs tabular-nums", customFovOff && "text-muted-foreground/60")}>{c.customFov}°</span>
          </>
        )
      },
      {
        id: "flySpeed",
        category: "camera",
        label: "Fly speed",
        description: "Base camera speed. Camera speed up/down multiply it.",
        modified: !isDefault("camera", "flySpeed"),
        reset: () => resetField("camera", "flySpeed"),
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
        modified: !isDefault("camera", "lookSensitivity"),
        reset: () => resetField("camera", "lookSensitivity"),
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
        modified: !isDefault("camera", "invertLookX"),
        reset: () => resetField("camera", "invertLookX"),
        control: <Switch checked={c.invertLookX} onCheckedChange={(v) => update("camera", { invertLookX: v })} />
      },
      {
        id: "invertY",
        category: "camera",
        label: "Invert look vertical",
        modified: !isDefault("camera", "invertLookY"),
        reset: () => resetField("camera", "invertLookY"),
        control: <Switch checked={c.invertLookY} onCheckedChange={(v) => update("camera", { invertLookY: v })} />
      },
      ...keybindRows,
      {
        id: "theme",
        category: "appearance",
        label: "Theme",
        modified: !isDefault("appearance", "theme"),
        reset: () => resetField("appearance", "theme"),
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
        modified: !isDefault("appearance", "gridVisible"),
        reset: () => resetField("appearance", "gridVisible"),
        control: <Switch checked={a.gridVisible} onCheckedChange={(v) => update("appearance", { gridVisible: v })} />
      },
      {
        id: "gridCell",
        category: "appearance",
        label: "Grid colour (1 m cells)",
        modified: !isDefault("appearance", "gridCellColor"),
        reset: () => resetField("appearance", "gridCellColor"),
        control: <Input type="color" className="h-7 w-14 p-0.5" value={a.gridCellColor} onChange={(e) => update("appearance", { gridCellColor: e.target.value })} />
      },
      {
        id: "gridSection",
        category: "appearance",
        label: "Grid colour (10 m sections)",
        modified: !isDefault("appearance", "gridSectionColor"),
        reset: () => resetField("appearance", "gridSectionColor"),
        control: <Input type="color" className="h-7 w-14 p-0.5" value={a.gridSectionColor} onChange={(e) => update("appearance", { gridSectionColor: e.target.value })} />
      }
    ]
  }, [settings, keybinds, defaults, listening])

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
  const searching = terms.length > 0
  const matches = (r: Row) => terms.every((t) => `${r.label} ${r.description ?? ""} ${r.group ?? ""} ${r.category}`.toLowerCase().includes(t))
  const matched = searching ? rows.filter(matches) : []
  const hitsPerCategory = new Map<SettingsCategory, number>()
  for (const r of matched) hitsPerCategory.set(r.category, (hitsPerCategory.get(r.category) ?? 0) + 1)
  const visible = searching
    ? matched.filter((r) => scope === null || r.category === scope)
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
  const modifiedIn = (category: SettingsCategory) => rows.some((r) => r.category === category && r.modified)

  return (
    <Dialog open={props.open} onOpenChange={(next) => !next && listening === null && props.onClose()}>
      <DialogContent className="flex h-[min(80vh,720px)] w-full gap-0 overflow-hidden p-0 sm:max-w-4xl" showCloseButton>
        <nav className="flex w-56 shrink-0 flex-col gap-1 border-r bg-muted/30 p-3">
          <div className="relative mb-2">
            <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-7"
              placeholder="Search settings"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setScope(null)
              }}
              aria-label="Search settings"
            />
          </div>
          {searching && (
            <Button variant={scope === null ? "secondary" : "ghost"} className="justify-between" onClick={() => setScope(null)}>
              <span>All results</span>
              <span className="text-[0.65rem] text-muted-foreground tabular-nums">{matched.length}</span>
            </Button>
          )}
          {CATEGORIES.map(({ id, label, icon: Icon }) => {
            const hits = hitsPerCategory.get(id) ?? 0
            const active = searching ? scope === id : props.category === id
            return (
              <Button
                key={id}
                variant={active ? "secondary" : "ghost"}
                className={cn("justify-start", searching && hits === 0 && "text-muted-foreground/50")}
                disabled={searching && hits === 0}
                onClick={() => {
                  if (searching) setScope(id)
                  else props.onCategoryChange(id)
                }}
                data-category={id}
              >
                <Icon />
                <span className="flex-1 text-left">{label}</span>
                {searching
                  ? hits > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-[0.65rem] text-primary tabular-nums">{hits}</span>
                  : modifiedIn(id) && <span className="size-1.5 rounded-full bg-primary" aria-label="Has changed settings" />}
              </Button>
            )
          })}
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
                    {group.rows.map((row) => <RowView key={row.id} row={row} />)}
                  </div>
                </section>
              ))}
              {groups.length === 0 && <p className="text-xs text-muted-foreground">No settings match.</p>}
            </div>
          </ScrollArea>
          <div className="flex justify-between border-t px-5 py-3">
            <Button variant="outline" onClick={resetCurrent} disabled={searching || !modifiedIn(props.category)}>
              Reset {current.label.toLowerCase()} to defaults
            </Button>
            <Button onClick={props.onClose} disabled={listening !== null}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
