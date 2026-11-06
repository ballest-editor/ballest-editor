import {
  IconCamera,
  IconDeviceGamepad2,
  IconKeyboard,
  IconPalette,
  IconPencil,
  IconSettings
} from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Slider, sliderValue } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { String as Str, Struct } from "effect"
import { useEffect } from "react"
import { movementLookModes } from "../domain/flyKeys"
import { namedActions } from "../domain/GameKeybinds"
import { overriddenFolders } from "../domain/gameLink"
import { isDefaultBinding, keybindActionDescriptions } from "../domain/Keybinds"
import { CUSTOM_FOV_PRESET, defaultSettings, gridColorsOf, type Settings } from "../domain/Settings"
import { refreshGameLink, resetGamePaths, resetKeybinds, saveSettings } from "../editor/actions"
import { type SettingsCategory, useCreator, useEditor } from "../editor/store"
import { useDarkTheme } from "../editor/theme"
import { ColorSetting } from "./ColorSetting"
import { creatorSettingsRow } from "./CreatorSetting"
import { CheckAgainButton, useGameLinkSettings } from "./GameLink"
import { useKeybindCapture } from "./KeybindControl"
import { NumberField } from "./NumberField"
import { type SettingsCategoryInfo, type SettingsRow, SettingsShell } from "./SettingsShell"

/** Each answers the row's label, "Movement keys need the look button". */
const movementLookItems = {
  all: "All",
  upDown: "Up, down and shared keys",
  conflicting: "Only keys shared with a tool",
  nothing: "None"
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

/** A grid colour's line: the swatch shows what it resolves to, this says where that comes from. */
const gridColorDescription = (value: string | null) => value === null ? "Automatic: follows the theme." : "Custom."

/** The Appearance page's group for what the viewport draws. */
const VIEWPORT = "Viewport"

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
  const capture = useKeybindCapture()
  const hasGame = useEditor((s) => s.capabilities.exportToGame)
  const projects = useEditor((s) => s.capabilities.projects)
  const overridden = overriddenFolders(useEditor((s) => s.gamePaths))
  const gameRows = useGameLinkSettings()
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
  /** A row on the page named after its section: its modified flag and reset, from its field. */
  const setting = <K extends keyof Settings & SettingsCategory>(section: K, key: keyof Settings[K]) => ({
    category: section,
    changes: { modified: !isDefault(section, key), reset: () => resetField(section, key) }
  })

  const rows = ((): ReadonlyArray<Row> => {
    const keybindRows = namedActions(defaults).map(({ action, section, label }): Row => ({
      id: `key-${action}`,
      category: "keybinds",
      group: section,
      label: Str.capitalize(label),
      description: keybindActionDescriptions[action],
      tooltip: true,
      changes: {
        modified: !isDefaultBinding(keybinds, defaults.keybinds, action),
        reset: () => capture.setBindings(action, defaults.keybinds[action])
      },
      control: capture.controlFor(action)
    }))

    const c = settings.camera
    const presetEntries: ReadonlyArray<readonly [string, string]> = [
      ...defaults.cameraPresets.map((p) => [p.id, `${p.label} (${p.fov}°)`] as const),
      [CUSTOM_FOV_PRESET, "Custom"]
    ]
    const presetItems = Object.fromEntries(presetEntries)
    const a = settings.appearance
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
        info: "Alt+drag on a move handle moves a copy and leaves the original in place. Off: Alt+drag is a plain move.",
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
            info: "Ask if unsaved opens it in this window and asks first only when this window has unsaved changes.",
            control: (
              <Choice
                value={settings.general.projectOpensIn}
                items={{ ask: "Ask if unsaved", thisWindow: "This window", newWindow: "A new window" }}
                onChange={(v) => update("general", { projectOpensIn: v })}
              />
            )
          } satisfies Row
        ]
        : []),
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
        info: projects
          ? "Automatic locks it in the desktop app."
          : "Automatic locks it in the desktop app and not in a browser: browsers show a notice on every lock, and Firefox on Linux turns slow diagonal looks into steps.",
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
        label: "Movement keys need the look button",
        description: "Shared keys are the ones a tool uses too.",
        keywords: "fly only while looking",
        control: (
          <Select
            value={c.movementNeedsLook}
            items={movementLookItems}
            onValueChange={(v) => v !== null && update("camera", { movementNeedsLook: v })}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-auto" align="end" alignItemWithTrigger={false}>
              {movementLookModes.toReversed().map((m) => (
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
      ...(hasGame ? gameRows : [])
    ]
  })()

  const resetCategory = (category: SettingsCategory) => {
    if (category === "keybinds") void resetKeybinds()
    else if (category === "game") void resetGamePaths(overridden)
    else if (category === "appearance") {
      // What the page shows: the Display popover's switches are in the same section, and they stay as they are.
      const shown = Struct.pick(defaultSettings.appearance, ["theme", "motion", "gridCellColor", "gridSectionColor"])
      void saveSettings({ ...settings, appearance: { ...settings.appearance, ...shown } })
    } else void saveSettings({ ...settings, [category]: defaultSettings[category] })
  }
  return (
    <SettingsShell
      open={props.open}
      onClose={props.onClose}
      title="Settings"
      description={`Settings for the editor, kept ${projects ? "on this computer" : "in this browser"}.`}
      categories={hasGame ? [...CATEGORIES, GAME_CATEGORY] : CATEGORIES}
      category={props.category}
      onCategoryChange={props.onCategoryChange}
      rows={rows}
      onResetCategory={resetCategory}
      footerAction={props.category === "game" && <CheckAgainButton />}
      busy={capture.capturing}
    />
  )
}
