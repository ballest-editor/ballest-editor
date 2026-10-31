import {
  IconCamera,
  IconKeyboard,
  IconPalette,
  IconPencil,
  IconPlus,
  IconSettings,
  IconSun,
  IconX
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { ColorPicker, ColorSwatch } from "@workspace/ui/components/color-picker"
import { Input } from "@workspace/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Slider } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { Struct } from "effect"
import { useEffect, useState } from "react"
import { movementLookModes } from "../domain/flyKeys"
import { namedActions } from "../domain/GameKeybinds"
import {
  type Bindings,
  chordOf,
  formatBinding,
  heldActions,
  isDefaultBinding,
  type KeybindAction,
  keybindActionDescriptions,
  keybindActionLabels,
  keybindActions,
  mouseChordOf,
  mouseClickActions,
  mouseDragActions,
  uniqueBindings,
  wheelChordOf
} from "../domain/Keybinds"
import { CUSTOM_FOV_PRESET, defaultSettings, gridColorsOf, type Settings } from "../domain/Settings"
import { resetKeybinds, saveKeybinds, saveSettings } from "../editor/actions"
import { type SettingsCategory, useEditor } from "../editor/store"
import { useDarkTheme } from "../editor/theme"
import { type SettingsCategoryInfo, type SettingsRow, SettingsShell } from "./SettingsShell"

const movementLookItems = {
  all: "All movement keys",
  upDown: "Up and down",
  conflicting: "Only conflicting keys",
  nothing: "Nothing"
} as const
const movementLookDescriptions = {
  all: "Every key needs look. The game's default.",
  upDown: "Up, down and keys shared with a tool need look.",
  conflicting: "Only keys shared with a tool need look.",
  nothing: "No key needs look. Shared keys fly and pick their tool."
} as const

const CATEGORIES: ReadonlyArray<SettingsCategoryInfo<SettingsCategory>> = [
  { id: "general", label: "General", icon: IconSettings },
  { id: "editor", label: "Editor", icon: IconPencil },
  { id: "camera", label: "Camera", icon: IconCamera },
  { id: "keybinds", label: "Keybinds", icon: IconKeyboard },
  { id: "appearance", label: "Appearance", icon: IconPalette },
  { id: "lighting", label: "Lighting", icon: IconSun }
]

type Row = SettingsRow<SettingsCategory>

/** base-ui sliders report a number, or an array for range sliders. */
const sliderValue = (value: number | ReadonlyArray<number>): number | undefined =>
  typeof value === "number" ? value : value[0]

/**
 * A colour setting that can be automatic (null): a swatch of the colour in use, opening the
 * same picker as the item colour properties, with a way back to automatic.
 */
function ColorSetting(props: {
  readonly label: string
  readonly value: string | null
  /** The colour automatic currently resolves to. */
  readonly auto: string
  readonly onChange: (value: string | null) => void
}) {
  const shown = props.value ?? props.auto
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${props.label}: ${props.value ?? `automatic (${props.auto})`}`}
        className="flex h-7 w-36 cursor-pointer items-center gap-2 rounded-md border border-input px-2 text-xs transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
      >
        <ColorSwatch color={shown} />
        <span className={cn("font-mono", props.value === null && "text-muted-foreground")}>
          {props.value ?? "Automatic"}
        </span>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-56 gap-2">
        <ColorPicker value={shown} onCommit={props.onChange} />
        <Button variant="outline" size="sm" disabled={props.value === null} onClick={() => props.onChange(null)}>
          Use automatic
        </Button>
      </PopoverContent>
    </Popover>
  )
}

const GRID_COLOR_DESCRIPTION = "Automatic suits the dark or light theme."

/** A binding being captured: a fresh slot (`index` = bindings.length) or a replacement. */
interface Listening {
  readonly action: KeybindAction
  readonly index: number
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
          ? <CaptureCap key="capture" />
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
  const dark = useDarkTheme(settings.appearance.theme)
  const autoGrid = gridColorsOf({ ...settings.appearance, gridCellColor: null, gridSectionColor: null }, dark)
  const keybinds = useEditor((s) => s.keybinds)
  const defaults = useEditor((s) => s.keybindDefaults)
  const [listening, setListening] = useState<Listening | null>(null)

  const update = <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) =>
    void saveSettings({ ...settings, [section]: { ...settings[section], ...patch } })
  const resetField = <K extends keyof Settings>(section: K, key: keyof Settings[K]) =>
    update(section, Struct.pick(defaultSettings[section], [key]))
  const isDefault = <K extends keyof Settings>(section: K, key: keyof Settings[K]) =>
    settings[section][key] === defaultSettings[section][key]
  /** The parts of a settings row that come from its field: category, modified flag, reset. */
  const setting = <K extends keyof Settings>(section: K, key: keyof Settings[K]) => ({
    category: section,
    changes: { modified: !isDefault(section, key), reset: () => resetField(section, key) }
  })

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
      void saveKeybinds({ ...keybinds, [action]: uniqueBindings(next) })
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

  const rows = ((): ReadonlyArray<Row> => {
    // A chord is a conflict when two actions of the same kind share it. A fly key doubling
    // as a tool shortcut (W: forward + translate, as in the game) is fine: the "fly only while
    // looking" setting decides which one it does. Mouse drags and selection clicks share a
    // kind: a camera drag chord never reaches click selection.
    const kinds = new Map<string, Set<string>>()
    for (const action of keybindActions) {
      const bindings = keybinds[action]
      const kind = heldActions.has(action)
        ? "held"
        : mouseDragActions.has(action) || mouseClickActions.has(action)
        ? "mouse"
        : "oneShot"
      for (const b of bindings) {
        const set = kinds.get(`${kind}:${b}`) ?? new Set<string>()
        set.add(action)
        kinds.set(`${kind}:${b}`, set)
      }
    }
    const conflicts = new Set(
      [...kinds].filter(([, actions]) => actions.size > 1).map(([key]) => key.slice(key.indexOf(":") + 1))
    )

    const keybindRows = namedActions(defaults).map(({ action, section, label }): Row => ({
      id: `key-${action}`,
      category: "keybinds",
      group: section,
      label,
      description: keybindActionDescriptions[action],
      tooltip: true,
      changes: {
        modified: !isDefaultBinding(keybinds, defaults.keybinds, action),
        reset: () => setBindings(action, defaults.keybinds[action])
      },
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

    const c = settings.camera
    const presetEntries: ReadonlyArray<readonly [string, string]> = [
      ...defaults.cameraPresets.map((p) => [p.id, `${p.label} (fov ${p.fov})`] as const),
      [CUSTOM_FOV_PRESET, `Custom (fov ${c.customFov})`]
    ]
    const presetItems = Object.fromEntries(presetEntries)
    const a = settings.appearance
    const l = settings.lighting
    const customFovOff = c.fovPreset !== CUSTOM_FOV_PRESET
    return [
      {
        id: "units",
        ...setting("general", "units"),
        label: "Units",
        description: "How positions are shown in the inspector. Map files always store centimetres.",
        control: (
          <Select
            value={settings.general.units}
            items={{ cm: "Centimetres", m: "Metres" }}
            onValueChange={(v) => v !== null && update("general", { units: v })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cm">Centimetres</SelectItem>
              <SelectItem value="m">Metres</SelectItem>
            </SelectContent>
          </Select>
        )
      },
      {
        id: "creatorName",
        ...setting("general", "creatorName"),
        label: "Creator name",
        description:
          "Your in-game name. Written into every exported map and its file name (letters, digits and spaces).",
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
        id: "altDragDuplicates",
        ...setting("general", "altDragDuplicates"),
        label: "Alt+drag duplicates",
        description:
          "Holding Alt while dragging a translate handle moves a copy of the selection and leaves the original in place, like the game. Turn off to make Alt+drag a plain move.",
        control: (
          <Switch
            checked={settings.general.altDragDuplicates}
            onCheckedChange={(v) => update("general", { altDragDuplicates: v })}
          />
        )
      },
      {
        id: "autosave",
        category: "general",
        label: "Autosave",
        description: "Coming later.",
        disabled: true,
        changes: { modified: false, reset: () => {} },
        control: <Switch disabled checked={false} />
      },
      {
        id: "placeDistance",
        ...setting("editor", "placeDistance"),
        label: "Placement distance",
        description:
          "How far from the camera a new piece lands when the floor is further away or out of sight. Pieces too wide to fit at this distance go further out.",
        control: (
          <>
            <Slider
              className="w-48"
              min={500}
              max={10000}
              step={100}
              largeStep={1000}
              value={settings.editor.placeDistance}
              onValueChange={(v) => {
                const placeDistance = sliderValue(v)
                if (placeDistance !== undefined) update("editor", { placeDistance })
              }}
            />
            <span className="w-20 text-right font-mono text-xs tabular-nums">
              {(settings.editor.placeDistance / 100).toFixed(0)} m
            </span>
          </>
        )
      },
      {
        id: "undoSelection",
        ...setting("editor", "undoSelection"),
        label: "Undo selection changes",
        description: "Make every selection change its own undo step.",
        control: (
          <Switch
            checked={settings.editor.undoSelection}
            onCheckedChange={(v) => update("editor", { undoSelection: v })}
          />
        )
      },
      {
        id: "fov",
        ...setting("camera", "fovPreset"),
        label: "Field of view",
        description:
          "The game's camera presets (from its camera settings). Only the field of view applies to the editor.",
        control: (
          <Select
            value={c.fovPreset}
            items={presetItems}
            onValueChange={(v) => update("camera", { fovPreset: String(v) })}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(presetItems).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        )
      },
      {
        id: "customFov",
        ...setting("camera", "customFov"),
        label: "Custom field of view",
        description: customFovOff
          ? "Horizontal degrees. Choose the Custom preset to use it."
          : "Horizontal degrees, used by the Custom preset (like the game).",
        disabled: customFovOff,
        control: (
          <>
            <Slider
              className="w-48"
              min={30}
              max={140}
              step={1}
              value={c.customFov}
              disabled={customFovOff}
              onValueChange={(v) => {
                const customFov = sliderValue(v)
                if (customFov !== undefined) update("camera", { customFov })
              }}
            />
            <span
              className={cn(
                "w-20 text-right font-mono text-xs tabular-nums",
                customFovOff && "text-muted-foreground/60"
              )}
            >
              {c.customFov}°
            </span>
          </>
        )
      },
      {
        id: "flySpeed",
        ...setting("camera", "flySpeed"),
        label: "Fly speed",
        description: "Base camera speed. Camera speed up/down multiply it.",
        control: (
          <>
            <Slider
              className="w-48"
              min={100}
              max={20000}
              step={100}
              value={c.flySpeed}
              onValueChange={(v) => {
                const flySpeed = sliderValue(v)
                if (flySpeed !== undefined) update("camera", { flySpeed })
              }}
            />
            <span className="w-20 text-right font-mono text-xs tabular-nums">{(c.flySpeed / 100).toFixed(0)} m/s</span>
          </>
        )
      },
      {
        id: "lookSensitivity",
        ...setting("camera", "lookSensitivity"),
        label: "Look sensitivity",
        control: (
          <>
            <Slider
              className="w-48"
              min={0.1}
              max={5}
              step={0.1}
              value={c.lookSensitivity}
              onValueChange={(v) => {
                const lookSensitivity = sliderValue(v)
                if (lookSensitivity !== undefined) update("camera", { lookSensitivity })
              }}
            />
            <span className="w-20 text-right font-mono text-xs tabular-nums">×{c.lookSensitivity.toFixed(1)}</span>
          </>
        )
      },
      {
        id: "invertX",
        ...setting("camera", "invertLookX"),
        label: "Invert look horizontal",
        control: <Switch checked={c.invertLookX} onCheckedChange={(v) => update("camera", { invertLookX: v })} />
      },
      {
        id: "invertY",
        ...setting("camera", "invertLookY"),
        label: "Invert look vertical",
        control: <Switch checked={c.invertLookY} onCheckedChange={(v) => update("camera", { invertLookY: v })} />
      },
      {
        id: "lockPointer",
        ...setting("camera", "lockPointer"),
        label: "Lock pointer while looking",
        description:
          "Hide the cursor and keep it in place while dragging the camera. Browsers show a notice on every lock, and Firefox on Linux turns slow diagonal looks into steps.",
        control: (
          <Select
            value={c.lockPointer}
            items={{ desktop: "Desktop app only", always: "Always", never: "Never" }}
            onValueChange={(v) => v !== null && update("camera", { lockPointer: v })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desktop">Desktop app only</SelectItem>
              <SelectItem value="always">Always</SelectItem>
              <SelectItem value="never">Never</SelectItem>
            </SelectContent>
          </Select>
        )
      },
      {
        id: "movementNeedsLook",
        ...setting("camera", "movementNeedsLook"),
        label: "Fly only while looking",
        description: "Which movement keys need the look button held.",
        control: (
          <Select
            value={c.movementNeedsLook}
            items={movementLookItems}
            onValueChange={(v) => v !== null && update("camera", { movementNeedsLook: v })}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-auto" align="end" alignItemWithTrigger={false}>
              {movementLookModes.map((m) => (
                <SelectItem key={m} value={m} className="py-1.5 pr-7">
                  <span className="flex flex-col gap-0.5">
                    <span>{movementLookItems[m]}</span>
                    <span className="opacity-70">{movementLookDescriptions[m]}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      },
      ...keybindRows,
      {
        id: "theme",
        ...setting("appearance", "theme"),
        label: "Theme",
        control: (
          <Select
            value={a.theme}
            items={{ dark: "Dark", light: "Light", system: "System" }}
            onValueChange={(v) => v !== null && update("appearance", { theme: v })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
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
        ...setting("appearance", "gridVisible"),
        label: "Show grid",
        control: <Switch checked={a.gridVisible} onCheckedChange={(v) => update("appearance", { gridVisible: v })} />
      },
      {
        id: "gridCell",
        ...setting("appearance", "gridCellColor"),
        label: "Grid colour (1 m cells)",
        description: GRID_COLOR_DESCRIPTION,
        control: (
          <ColorSetting
            label="Grid colour (1 m cells)"
            value={a.gridCellColor}
            auto={autoGrid.cell}
            onChange={(v) => update("appearance", { gridCellColor: v })}
          />
        )
      },
      {
        id: "gridSection",
        ...setting("appearance", "gridSectionColor"),
        label: "Grid colour (10 m sections)",
        description: GRID_COLOR_DESCRIPTION,
        control: (
          <ColorSetting
            label="Grid colour (10 m sections)"
            value={a.gridSectionColor}
            auto={autoGrid.section}
            onChange={(v) => update("appearance", { gridSectionColor: v })}
          />
        )
      },
      {
        id: "waterVisible",
        ...setting("appearance", "waterVisible"),
        label: "Show water",
        description:
          "The level's water surface. In game, pieces below it are hidden, and a ball that falls in respawns.",
        control: <Switch checked={a.waterVisible} onCheckedChange={(v) => update("appearance", { waterVisible: v })} />
      },
      {
        id: "mapLighting",
        ...setting("lighting", "mapLighting"),
        label: "Map lighting",
        description:
          "Light the viewport with the map's sun and sky, as set in the inspector's Lighting section. Off: fixed studio lights.",
        control: <Switch checked={l.mapLighting} onCheckedChange={(v) => update("lighting", { mapLighting: v })} />
      },
      {
        id: "skyVisible",
        ...setting("lighting", "skyVisible"),
        label: "Show sky",
        description: "The game's sky with the map's sun in it. Off: the theme's background.",
        control: <Switch checked={l.skyVisible} onCheckedChange={(v) => update("lighting", { skyVisible: v })} />
      }
    ]
  })()

  const resetCategory = (category: SettingsCategory) => {
    if (category === "keybinds") void resetKeybinds()
    else void saveSettings({ ...settings, [category]: defaultSettings[category] })
  }
  return (
    <SettingsShell
      open={props.open}
      onClose={props.onClose}
      title="Settings"
      description="Settings for the editor, kept in this browser."
      categories={CATEGORIES}
      category={props.category}
      onCategoryChange={props.onCategoryChange}
      rows={rows}
      onResetCategory={resetCategory}
      busy={listening !== null}
    />
  )
}
