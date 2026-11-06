import {
  IconCamera,
  IconDeviceGamepad2,
  IconKeyboard,
  IconPalette,
  IconPencil,
  IconPlus,
  IconSettings,
  IconX
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { ColorPicker, ColorSwatch } from "@workspace/ui/components/color-picker"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Slider, sliderValue } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { String as Str, Struct } from "effect"
import { useEffect, useState } from "react"
import { movementLookModes } from "../domain/flyKeys"
import { namedActions } from "../domain/GameKeybinds"
import { overriddenFolders } from "../domain/gameLink"
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
import { refreshGameLink, resetGamePaths, resetKeybinds, saveKeybinds, saveSettings } from "../editor/actions"
import { type SettingsCategory, useCreator, useEditor } from "../editor/store"
import { useDarkTheme } from "../editor/theme"
import { creatorSettingsRow } from "./CreatorSetting"
import { CheckAgainButton, useGameLinkSettings } from "./GameLink"
import { NumberField } from "./NumberField"
import { type SettingsCategoryInfo, type SettingsRow, SettingsShell } from "./SettingsShell"
import { useUpdateCheck } from "./UpdateCheck"

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
  { id: "appearance", label: "Appearance", icon: IconPalette }
]

/** Desktop only: the Game link's home. */
const GAME_CATEGORY: SettingsCategoryInfo<SettingsCategory> = { id: "game", label: "Game", icon: IconDeviceGamepad2 }

type Row = SettingsRow<SettingsCategory>

/** A setting picked from a short list: `items` is each value's label, in order. */
function Choice<V extends string>({ value, items, onChange, className = "w-40" }: {
  readonly value: V
  readonly items: Readonly<Record<V, string>>
  readonly onChange: (value: V) => void
  readonly className?: string
}) {
  return (
    <Select value={value} items={items} onValueChange={(v: V | null) => v !== null && onChange(v)}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries<string>(items).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/**
 * A setting on a slider: 160px of track, then its value as a field with its unit. `scale` is how much of the stored
 * value one shown unit is (centimetres to the metre). What is typed lands on a step of the slider, inside its range.
 */
function SliderControl({ label, unit, digits = 0, scale = 1, value, onChange, ...range }: {
  readonly label: string
  readonly unit: string
  readonly digits?: number
  readonly scale?: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly largeStep?: number
  readonly value: number
  readonly onChange: (value: number) => void
}) {
  const { min, max, step } = range
  return (
    <>
      {/* its own box: the Slider fills what it is given, and a width on it loses to that */}
      <div className="w-40 shrink-0">
        <Slider
          aria-label={label}
          {...range}
          value={value}
          onValueChange={(v) => {
            const next = sliderValue(v)
            if (next !== undefined) onChange(next)
          }}
        />
      </div>
      <div className="w-16 shrink-0">
        <NumberField
          label={label}
          value={value / scale}
          digits={digits}
          handle={false}
          onCommit={(n) => onChange(Math.min(max, Math.max(min, Math.round((n * scale) / step) * step)))}
        />
      </div>
      <span className="w-7 shrink-0 text-body whitespace-nowrap text-fg-tertiary">{unit}</span>
    </>
  )
}

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
        className="flex h-7 w-40 cursor-pointer items-center gap-2 rounded-control border border-input px-2 text-body transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
      >
        <ColorSwatch color={shown} />
        <span className={cn("tabular-nums", props.value === null && "text-fg-tertiary")}>{shown}</span>
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

/** A grid colour's line: the swatch shows what it resolves to, this says where that comes from. */
const gridColorDescription = (value: string | null) => value === null ? "Automatic: follows the theme." : "Custom."

/** The Appearance page's group for what the viewport draws. */
const VIEWPORT = "Viewport"

/** A binding being captured: a fresh slot (`index` = bindings.length) or a replacement. */
interface Listening {
  readonly action: KeybindAction
  readonly index: number
}

/**
 * An action's bindings as key caps (hover or focus one to reveal its ×, which slides in), a
 * dashed + cap for a secondary binding, and a capture cap while listening. Caps bound to more
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
                "group/cap inline-flex h-6 items-stretch overflow-hidden rounded-control border bg-muted text-caption leading-none text-foreground tabular-nums",
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
                className="flex w-0 items-center justify-center overflow-hidden text-fg-secondary transition-[width] duration-150 group-focus-within/cap:w-5 group-focus-within/cap:border-l group-focus-within/cap:border-border group-hover/cap:w-5 group-hover/cap:border-l group-hover/cap:border-border hover:bg-destructive/15 hover:text-destructive"
                onClick={() => props.onRemove(index)}
                aria-label={`Unbind ${formatBinding(binding)} from ${label}`}
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
            className="inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-control border border-dashed border-border px-1.5 text-caption text-fg-secondary hover:border-foreground/40 hover:text-foreground"
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

/** Trims the line box to the glyphs' cap height (Chrome 133+); older engines fall back to leading-none. */
const CAP_TEXT = "leading-none [text-box:trim-both_cap_alphabetic]"

/** Shown in place of the cap being (re)bound: same shape, primary ring, blinking caret. */
function CaptureCap() {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-control border border-primary/40 bg-primary/15 px-2 text-caption text-[color-mix(in_oklch,var(--primary),var(--foreground)_45%)]">
      <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
      <span className={CAP_TEXT}>Press a key</span>
    </span>
  )
}

/**
 * A press that fills a slot ends the capture, and its listeners with it, before the button comes up. What's left of the
 * press mustn't act on what's under the pointer: on the backdrop, its click would close the dialog.
 */
const swallowRestOfPress = () => {
  const swallow = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const onUp = (e: Event) => {
    swallow(e)
    window.removeEventListener("mouseup", onUp, { capture: true })
    // Only the main button makes a click, and it comes straight after the mouseup.
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }))
  }
  window.addEventListener("mouseup", onUp, { capture: true })
  window.addEventListener("click", swallow, { capture: true })
}

/** File › Settings…, a modal: category nav on the left, searchable rows on the right. */
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
  const hasGame = useEditor((s) => s.capabilities.exportToGame)
  const projects = useEditor((s) => s.capabilities.projects)
  const overridden = overriddenFolders(useEditor((s) => s.gamePaths))
  const gameRows = useGameLinkSettings()
  const updateCheck = useUpdateCheck()
  const creator = useCreator()
  const foundCreator = useEditor((s) => s.foundCreator)

  // The game or the plugin manager may have been installed, run or moved since, and Steam logged in as someone else:
  // look the folders, the plugin and the creator name up each time the dialog opens.
  useEffect(() => {
    if (props.open && hasGame) void refreshGameLink()
  }, [props.open, hasGame])

  const update = <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) =>
    void saveSettings({ ...settings, [section]: { ...settings[section], ...patch } })
  const resetField = <K extends keyof Settings>(section: K, key: keyof Settings[K]) =>
    update(section, Struct.pick(defaultSettings[section], [key]))
  const isDefault = <K extends keyof Settings>(section: K, key: keyof Settings[K]) =>
    settings[section][key] === defaultSettings[section][key]
  /** A settings row's modified flag and reset, from its field. */
  const changesOf = <K extends keyof Settings>(section: K, key: keyof Settings[K]) => ({
    changes: { modified: !isDefault(section, key), reset: () => resetField(section, key) }
  })
  /** The same, for a row on the page named after its section. */
  const setting = <K extends keyof Settings & SettingsCategory>(section: K, key: keyof Settings[K]) => ({
    category: section,
    ...changesOf(section, key)
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
      swallowRestOfPress()
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
      label: Str.capitalize(label),
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
      ...defaults.cameraPresets.map((p) => [p.id, `${p.label} (${p.fov}°)`] as const),
      [CUSTOM_FOV_PRESET, "Custom"]
    ]
    const presetItems = Object.fromEntries(presetEntries)
    const a = settings.appearance
    const l = settings.lighting
    return [
      {
        id: "units",
        ...setting("general", "units"),
        label: "Units",
        description: "How the inspector shows positions.",
        info: "Map files always store centimetres.",
        control: (
          <Choice
            value={settings.general.units}
            items={{ cm: "Centimetres", m: "Metres" }}
            onChange={(v) => update("general", { units: v })}
          />
        )
      },
      creatorSettingsRow({
        creator,
        setting: settings.general.creatorName,
        found: foundCreator,
        onChange: (creatorName) => update("general", { creatorName })
      }),
      {
        id: "altDragDuplicates",
        ...setting("general", "altDragDuplicates"),
        label: "Alt+drag duplicates",
        description: "Alt+drag moves a copy, like the game.",
        info:
          "Alt+drag on a translate handle moves a copy and leaves the original in place. Off: Alt+drag is a plain move.",
        control: (
          <Switch
            checked={settings.general.altDragDuplicates}
            onCheckedChange={(v) => update("general", { altDragDuplicates: v })}
          />
        )
      },
      ...(hasGame
        ? [
          {
            id: "exportOnSaveAll",
            ...setting("general", "exportOnSave"),
            label: "Export every save",
            description: "Every Save also exports the map to the game.",
            info: "Off: only maps with their own Export on save are exported.",
            control: (
              <Switch
                checked={settings.general.exportOnSave}
                onCheckedChange={(v) => update("general", { exportOnSave: v })}
              />
            )
          } satisfies Row
        ]
        : []),
      ...(projects
        ? [
          {
            id: "projectOpensIn",
            ...setting("general", "projectOpensIn"),
            label: "Open projects in",
            description: "Where a project you open or make goes.",
            info: "For New project, Open project and Recent projects.",
            control: (
              <Choice
                value={settings.general.projectOpensIn}
                items={{ ask: "Ask each time", thisWindow: "This window", newWindow: "A new window" }}
                onChange={(v) => update("general", { projectOpensIn: v })}
              />
            )
          } satisfies Row
        ]
        : []),
      ...(updateCheck === null
        ? []
        : [
          {
            id: "version",
            category: "general",
            label: "Version",
            description: updateCheck.summary,
            keywords: "version release new latest check download install",
            changes: { modified: false, reset: () => {} },
            control: updateCheck.button
          } satisfies Row
        ]),
      {
        id: "placeDistance",
        ...setting("editor", "placeDistance"),
        label: "Placement distance",
        description: "Where a piece lands with no floor in reach.",
        info: "How far from the camera a new piece lands when the floor is out of reach. Wider pieces go further.",
        control: (
          <SliderControl
            label="Placement distance"
            unit="m"
            scale={100}
            min={500}
            max={10000}
            step={100}
            largeStep={1000}
            value={settings.editor.placeDistance}
            onChange={(placeDistance) => update("editor", { placeDistance })}
          />
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
        description: "The game's camera presets.",
        info: "From the game's camera settings. Only the field of view applies to the editor.",
        keywords: "custom fov",
        control: (
          <Choice
            className="w-56"
            value={c.fovPreset}
            items={presetItems}
            onChange={(fovPreset) => update("camera", { fovPreset })}
          />
        )
      },
      ...(c.fovPreset === CUSTOM_FOV_PRESET
        ? [
          {
            id: "customFov",
            ...setting("camera", "customFov"),
            label: "Custom field of view",
            description: "Horizontal, like the game's.",
            control: (
              <SliderControl
                label="Custom field of view"
                unit="°"
                min={30}
                max={140}
                step={1}
                value={c.customFov}
                onChange={(customFov) => update("camera", { customFov })}
              />
            )
          } satisfies Row
        ]
        : []),
      {
        id: "flySpeed",
        ...setting("camera", "flySpeed"),
        label: "Fly speed",
        description: "Camera speed up and down multiply it.",
        control: (
          <SliderControl
            label="Fly speed"
            unit="m/s"
            scale={100}
            min={100}
            max={20000}
            step={100}
            value={c.flySpeed}
            onChange={(flySpeed) => update("camera", { flySpeed })}
          />
        )
      },
      {
        id: "lookSensitivity",
        ...setting("camera", "lookSensitivity"),
        label: "Look sensitivity",
        control: (
          <SliderControl
            label="Look sensitivity"
            unit="×"
            digits={1}
            min={0.1}
            max={5}
            step={0.1}
            value={c.lookSensitivity}
            onChange={(lookSensitivity) => update("camera", { lookSensitivity })}
          />
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
        description: "Hide the cursor while dragging the camera.",
        info:
          "Automatic locks it in the desktop app and not in a browser: browsers show a notice on every lock, and Firefox on Linux turns slow diagonal looks into steps.",
        control: (
          <Choice
            value={c.lockPointer}
            items={{ desktop: "Automatic", always: "Always", never: "Never" }}
            onChange={(v) => update("camera", { lockPointer: v })}
          />
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
          <Choice
            value={a.theme}
            items={{ dark: "Dark", light: "Light", system: "System" }}
            onChange={(v) => update("appearance", { theme: v })}
          />
        )
      },
      {
        id: "motion",
        ...setting("appearance", "motion"),
        label: "Animation speed",
        description: "How fast panels, menus and tabs animate.",
        control: (
          <Choice
            value={a.motion}
            items={{ off: "Off", fast: "Fast", normal: "Normal", slow: "Slow" }}
            onChange={(v) => update("appearance", { motion: v })}
          />
        )
      },
      {
        id: "gridVisible",
        ...setting("appearance", "gridVisible"),
        group: VIEWPORT,
        label: "Show grid",
        control: <Switch checked={a.gridVisible} onCheckedChange={(v) => update("appearance", { gridVisible: v })} />
      },
      {
        id: "gridCell",
        ...setting("appearance", "gridCellColor"),
        group: VIEWPORT,
        label: "Grid colour (1 m cells)",
        description: gridColorDescription(a.gridCellColor),
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
        group: VIEWPORT,
        label: "Grid colour (10 m sections)",
        description: gridColorDescription(a.gridSectionColor),
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
        group: VIEWPORT,
        label: "Show water",
        description: "The level's water surface.",
        info: "In game, pieces below it are hidden, and a ball that falls in respawns.",
        control: <Switch checked={a.waterVisible} onCheckedChange={(v) => update("appearance", { waterVisible: v })} />
      },
      {
        id: "mapLighting",
        category: "appearance",
        ...changesOf("lighting", "mapLighting"),
        group: VIEWPORT,
        label: "Map lighting",
        description: "Light the viewport with the map's sun and sky.",
        info: "The inspector's Lighting section sets them. Off: fixed studio lights.",
        control: <Switch checked={l.mapLighting} onCheckedChange={(v) => update("lighting", { mapLighting: v })} />
      },
      {
        id: "skyVisible",
        category: "appearance",
        ...changesOf("lighting", "skyVisible"),
        group: VIEWPORT,
        label: "Show sky",
        description: "The game's sky with the map's sun in it.",
        info: "Off: the theme's background.",
        control: <Switch checked={l.skyVisible} onCheckedChange={(v) => update("lighting", { skyVisible: v })} />
      },
      ...(hasGame ? gameRows : [])
    ]
  })()

  const resetCategory = (category: SettingsCategory) => {
    if (category === "keybinds") void resetKeybinds()
    else if (category === "game") void resetGamePaths(overridden)
    else if (category === "appearance") {
      void saveSettings({ ...settings, appearance: defaultSettings.appearance, lighting: defaultSettings.lighting })
    } else void saveSettings({ ...settings, [category]: defaultSettings[category] })
  }
  return (
    <SettingsShell
      open={props.open}
      onClose={props.onClose}
      title="Settings"
      description="Settings for the editor, kept in this browser."
      categories={hasGame ? [...CATEGORIES, GAME_CATEGORY] : CATEGORIES}
      category={props.category}
      onCategoryChange={props.onCategoryChange}
      rows={rows}
      onResetCategory={resetCategory}
      footerAction={props.category === "game" && <CheckAgainButton />}
      busy={listening !== null}
    />
  )
}
