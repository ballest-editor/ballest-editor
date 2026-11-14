import {
  IconCamera,
  IconDeviceGamepad2,
  IconFlask,
  IconKeyboard,
  IconPalette,
  IconPencil,
  IconSettings
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Slider, sliderValue } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { String as Str, Struct } from "effect"
import { useEffect } from "react"
import { AREA_RULE_NAMES } from "../domain/areaSelect"
import { movementLookModes } from "../domain/flyKeys"
import { namedActions } from "../domain/GameKeybinds"
import { overriddenFolders } from "../domain/gameLink"
import { actionWhen, isDefaultBinding, keybindActionDescriptions } from "../domain/Keybinds"
import { describeWhen } from "../domain/keyContext"
import { AUTO_GRID_COLORS, CUSTOM_FOV_PRESET, defaultSettings, type Settings } from "../domain/Settings"
import { BODY_DRAG_NAMES, type SnapPrefs } from "../domain/snapPrefs"
import {
  refreshGameLink,
  resetGamePaths,
  resetKeybinds,
  resetSnapDefaults,
  saveSettings,
  setUsageStatsEnabled,
  snapDefaultsAreFactory,
  updateSettings,
  watchGameLink
} from "../editor/actions"
import { type SettingsCategory, useCreator, useEditor } from "../editor/store"
import { useDarkTheme } from "../editor/theme"
import { ColorSetting } from "./ColorSetting"
import { creatorSettingsRow } from "./CreatorSetting"
import { CheckAgainButton, useGameLinkSettings } from "./GameLink"
import { KeybindWhen, useKeybindCapture } from "./KeybindControl"
import { NumberField } from "./NumberField"
import { type SettingsCategoryInfo, type SettingsRow, SettingsShell } from "./SettingsShell"
import { siteAccountSettingsRow } from "./SiteAccountSetting"

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
  { id: "appearance", label: "Appearance", icon: IconPalette },
  { id: "beta", label: "Beta", icon: IconFlask }
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

/** File › Settings…, a modal: category nav on the left, searchable rows on the right. */
export function SettingsDialog(props: {
  readonly open: boolean
  readonly category: SettingsCategory
  readonly onCategoryChange: (category: SettingsCategory) => void
  readonly onClose: () => void
}) {
  const settings = useEditor((s) => s.settings)
  const autoGrid = AUTO_GRID_COLORS[useDarkTheme(settings.appearance.theme) ? "dark" : "light"]
  const keybinds = useEditor((s) => s.keybinds)
  const defaults = useEditor((s) => s.keybindDefaults)
  const capture = useKeybindCapture()
  const hasGame = useEditor((s) => s.capabilities.exportToGame)
  const projects = useEditor((s) => s.capabilities.projects)
  const overridden = overriddenFolders(useEditor((s) => s.gamePaths))
  const gameRows = useGameLinkSettings()
  const creator = useCreator()
  const foundCreator = useEditor((s) => s.foundCreator)
  const snapFactory = useEditor(snapDefaultsAreFactory)
  const usageStats = useEditor((s) => s.usageStats)
  const site = useEditor((s) => s.capabilities.site)
  const siteAccount = useEditor((s) => s.siteAccount)

  // The game or the plugin manager may have been installed, run or moved since, and Steam logged in as someone else:
  // look the folders, the plugin and the creator name up each time the dialog opens.
  useEffect(() => {
    if (props.open && hasGame) void refreshGameLink()
  }, [props.open, hasGame])

  // ...and keep looking while the Game page shows, so what the user fixes in another window flips its row by itself.
  const onGamePage = props.open && hasGame && props.category === "game"
  useEffect(() => {
    if (!onGamePage) return
    return watchGameLink()
  }, [onGamePage])

  const update = <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) =>
    void updateSettings(section, patch)
  /** A row on the page named after its section: its modified flag and reset, from its field. */
  const setting = <K extends keyof Settings & SettingsCategory>(section: K, key: keyof Settings[K]) => ({
    category: section,
    changes: {
      modified: settings[section][key] !== defaultSettings[section][key],
      reset: () => update(section, Struct.pick(defaultSettings[section], [key]))
    }
  })

  /** A row of the Editor page's Snapping group: how snapping behaves for you in every map (docs/SNAPPING.md § Settings). */
  const snapSetting = (key: keyof SnapPrefs) => ({
    category: "editor" as const,
    group: "Snapping",
    keywords: "snap snapping",
    changes: {
      modified: settings.snapPrefs[key] !== defaultSettings.snapPrefs[key],
      reset: () => update("snapPrefs", Struct.pick(defaultSettings.snapPrefs, [key]))
    }
  })
  const prefs = settings.snapPrefs

  const rows = ((): ReadonlyArray<Row> => {
    const keybindRows = namedActions(defaults).map(({ action, section, label }): Row => ({
      id: `key-${action}`,
      category: "keybinds",
      group: section,
      label: Str.capitalize(label),
      description: keybindActionDescriptions[action],
      tooltip: true,
      detail: <KeybindWhen action={action} />,
      keywords: describeWhen(actionWhen[action]),
      changes: {
        modified: !isDefaultBinding(keybinds, defaults.keybinds, action),
        reset: () => capture.setBindings(action, defaults.keybinds[action])
      },
      control: capture.controlFor(action)
    }))

    const c = settings.camera
    const presetItems = Object.fromEntries([
      ...defaults.cameraPresets.map((p) => [p.id, `${p.label} (${p.fov}°)`] as const),
      [CUSTOM_FOV_PRESET, "Custom"] as const
    ])
    const a = settings.appearance
    /** A row of the Appearance page's Viewport group: the swatch is what the colour resolves to, its line where from. */
    const gridColorRow = (id: string, key: "gridCellColor" | "gridSectionColor", label: string, auto: string): Row => ({
      id,
      ...setting("appearance", key),
      group: "Viewport",
      label,
      description: a[key] === null ? "Automatic: follows the theme." : "Custom.",
      control: (
        <ColorSetting
          label={label}
          value={a[key]}
          auto={auto}
          onChange={(v) => update("appearance", { [key]: v })}
        />
      )
    })
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
            items={{ cm: "Centimeters", m: "Meters" }}
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
      ...(usageStats !== null
        ? [
          {
            id: "usageStats",
            category: "general",
            label: "Send usage statistics",
            description: usageStats.collecting
              ? "Anonymous: sessions, the version and errors."
              : "This build sends none: only an installed Ballest Editor does.",
            info:
              "Sent: a random install id, the app's version, your platform and its version, how long each session runs, and errors with paths and names taken out. Never your maps, your names or your Steam account. Off also deletes the install id and anything not sent yet.",
            keywords: "telemetry privacy analytics",
            changes: { modified: !usageStats.enabled, reset: () => void setUsageStatsEnabled(true) },
            control: <Switch checked={usageStats.enabled} onCheckedChange={(v) => void setUsageStatsEnabled(v)} />
          } satisfies Row
        ]
        : []),
      ...(site ? [siteAccountSettingsRow(siteAccount)] : []),
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
        id: "areaSelect",
        ...setting("editor", "areaSelect"),
        label: "Box selects",
        description: "What a box or lasso takes: by the drag's direction, or always one rule.",
        info:
          "By direction: dragged left to right, a box takes what is wholly inside it; right to left, anything it touches. Touching and Wholly inside fix one rule whichever way it is dragged.",
        control: (
          <Choice
            value={settings.editor.areaSelect}
            items={AREA_RULE_NAMES}
            onChange={(v) => update("editor", { areaSelect: v })}
          />
        )
      },
      {
        id: "snapBodyDrag",
        ...snapSetting("bodyDrag"),
        label: "Drag body",
        description: "When dragging a piece itself moves it.",
        info: "When dragging the piece itself, not the gizmo, moves it: only to join ends, always, or never.",
        control: (
          <Choice
            value={prefs.bodyDrag}
            items={BODY_DRAG_NAMES}
            onChange={(v) => update("snapPrefs", { bodyDrag: v })}
          />
        )
      },
      {
        id: "snapShowOpenEnds",
        ...snapSetting("showOpenEnds"),
        label: "Show open ends",
        description: "Rings the ends of tracks with nothing joined.",
        info: "When to mark the ends that have nothing joined to them yet.",
        control: (
          <Choice
            value={prefs.showOpenEnds}
            items={{ never: "Never", hover: "On hover", always: "Always" }}
            onChange={(v) => update("snapPrefs", { showOpenEnds: v })}
          />
        )
      },
      {
        id: "snapProfiles",
        ...snapSetting("profiles"),
        label: "Profiles",
        description: "Whether ends of different shapes join.",
        info:
          "Whether ends of different shapes join: never (Strict), with a warning, or always (Any). Example: a half tube's end on a full tube's.",
        control: (
          <Choice
            value={prefs.profiles}
            items={{ strict: "Strict", warn: "Warn", any: "Any" }}
            onChange={(v) => update("snapPrefs", { profiles: v })}
          />
        )
      },
      {
        id: "snapFlipToFit",
        ...snapSetting("flipToFit"),
        label: "Flip to fit",
        description: "Offers a piece's mirror image when that fits.",
        info: "Offers the piece's mirror image when that one would fit where this one doesn't.",
        control: <Switch checked={prefs.flipToFit} onCheckedChange={(v) => update("snapPrefs", { flipToFit: v })} />
      },
      {
        id: "snapOcclusion",
        ...snapSetting("occlusion"),
        label: "Occlusion",
        description: "Whether hidden parts of pieces snap.",
        info:
          "Whether parts of pieces hidden behind others can be snapped to (Through) or only what you can see (In front).",
        control: (
          <Choice
            value={prefs.occlusion}
            items={{ front: "In front only", through: "Through pieces" }}
            onChange={(v) => update("snapPrefs", { occlusion: v })}
          />
        )
      },
      {
        id: "snapTrackingKeep",
        ...snapSetting("trackingKeep"),
        label: "Points kept",
        description: "How many points Point guides remember.",
        info: "How many points a drag remembers to draw guides from.",
        control: (
          <SliderControl
            label="Points kept"
            unit=""
            min={1}
            max={20}
            step={1}
            value={prefs.trackingKeep}
            onChange={(trackingKeep) => update("snapPrefs", { trackingKeep })}
          />
        )
      },
      {
        id: "snapTrackingHover",
        ...snapSetting("trackingHoverMs"),
        label: "Hover time",
        description: "How long a rest during a drag takes to remember a point.",
        info:
          "How long the pointer rests on a point during a drag before it is remembered. The drag forgets it as it ends.",
        control: (
          <SliderControl
            label="Hover time"
            unit="ms"
            min={0}
            max={2000}
            step={50}
            value={prefs.trackingHoverMs}
            onChange={(trackingHoverMs) => update("snapPrefs", { trackingHoverMs })}
          />
        )
      },
      {
        id: "snapTrackingAcquire",
        ...snapSetting("trackingAcquire"),
        label: "Remember points",
        description: "By resting the pointer, or only with Shift.",
        info: "Whether resting on a point remembers it, or only resting on it with Shift held.",
        control: (
          <Choice
            value={prefs.trackingAcquire}
            items={{ auto: "Automatically", shift: "With Shift" }}
            onChange={(v) => update("snapPrefs", { trackingAcquire: v })}
          />
        )
      },
      {
        id: "snapDefaults",
        category: "editor",
        group: "Snapping",
        label: "New maps' snapping",
        description: "What the snap menu's Save as defaults keeps.",
        info: "Reset puts back the snapping a new map started on at first. A map with snapping of its own keeps it.",
        keywords: "snap snapping factory",
        control: (
          <Button variant="outline" disabled={snapFactory} onClick={() => void resetSnapDefaults()}>
            Reset snapping defaults
          </Button>
        )
      },
      {
        id: "chainLay",
        ...setting("beta", "chainLay"),
        label: "Lay chains along a shape",
        description: "Adds Lay along to a chain's section in the Inspector: Straight and Helix.",
        info: "Still taking shape: it may change or go away.",
        keywords: "chain helix straight beta",
        control: (
          <Switch
            checked={settings.beta.chainLay}
            onCheckedChange={(v) => update("beta", { chainLay: v })}
          />
        )
      },
      {
        id: "approximate",
        ...setting("beta", "approximate"),
        label: "Approximate 3D models",
        description: "Adds Approximate 3D model… to the Tools menu: a prefab of pieces shaped like a 3D file.",
        info:
          "Still taking shape: it may change or go away. Reads GLB, glTF, STL, OBJ, PLY, 3MF and FBX files, and fitting one can take half a minute.",
        keywords: "approximate import model mesh stl glb obj 3d prefab plates beta",
        control: (
          <Switch
            checked={settings.beta.approximate}
            onCheckedChange={(v) => update("beta", { approximate: v })}
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
        id: "axesSize",
        ...setting("camera", "axesSize"),
        label: "Axes size",
        description: "The axes under each pane's label. Its menu has this too.",
        keywords: "view gizmo orientation",
        control: (
          <Choice
            value={c.axesSize}
            items={{ s: "Small", m: "Medium", l: "Large" }}
            onChange={(axesSize) => update("camera", { axesSize })}
          />
        )
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
      gridColorRow("gridCell", "gridCellColor", "Grid color (1 m cells)", autoGrid.cell),
      gridColorRow("gridSection", "gridSectionColor", "Grid color (10 m sections)", autoGrid.section),
      ...(hasGame ? gameRows : [])
    ]
  })()

  const resetCategory = (category: SettingsCategory) => {
    if (category === "keybinds") void resetKeybinds()
    else if (category === "game") void resetGamePaths(overridden)
    else if (category === "appearance") {
      // What the page shows: the Display popover's switches are in the same section, and they stay as they are.
      update(
        "appearance",
        Struct.pick(defaultSettings.appearance, ["theme", "motion", "gridCellColor", "gridSectionColor"])
      )
    } else if (category === "editor") {
      // The page shows your snapping too; what new maps start on has its own button.
      void saveSettings({ ...settings, editor: defaultSettings.editor, snapPrefs: defaultSettings.snapPrefs })
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
