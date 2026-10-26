#!/usr/bin/env node
// Build assets/keybinds.json from the `BallestExtract dump` of the input assets.
// usage: node build-keybinds.mjs INPUT_DUMP.json OUT.json
import { readFileSync, writeFileSync } from "node:fs";

const [dumpPath, outPath] = process.argv.slice(2);
if (!outPath) {
  console.error("usage: build-keybinds.mjs INPUT_DUMP.json OUT.json");
  process.exit(2);
}
const dump = JSON.parse(readFileSync(dumpPath, "utf8"));

// UE 5.8 class defaults (EnhancedInput/Public/InputModifiers.h, InputTriggers.h). Cooked
// subobjects only store properties that differ from these, so merge to get effective values.
const DEFAULTS = {
  InputModifierNegate: { bX: true, bY: true, bZ: true },
  InputModifierSwizzleAxis: { Order: "EInputAxisSwizzle::YXZ" },
  InputModifierScalar: { Scalar: { X: 1, Y: 1, Z: 1 } },
  InputModifierDeadZone: { LowerThreshold: 0.2, UpperThreshold: 1, Type: "EDeadZoneType::Radial" },
  InputModifierSmoothDelta: { Speed: 0.5, EasingExponent: 2 },
  InputModifierResponseCurveExponential: { CurveExponent: { X: 1, Y: 1, Z: 1 } },
  InputModifierFOVScaling: { FOVScale: 1 },
  InputTriggerHold: { HoldTimeThreshold: 1, bIsOneShot: false, ActuationThreshold: 0.5 },
  InputTriggerHoldAndRelease: { HoldTimeThreshold: 0.5, ActuationThreshold: 0.5 },
  InputTriggerTap: { TapReleaseTimeThreshold: 0.2, ActuationThreshold: 0.5 },
  InputTriggerPulse: { bTriggerOnStart: true, Interval: 1, TriggerLimit: 0, ActuationThreshold: 0.5 },
  InputTriggerDown: { ActuationThreshold: 0.5 },
  InputTriggerPressed: { ActuationThreshold: 0.5 },
  InputTriggerReleased: { ActuationThreshold: 0.5 },
};

const field = (obj, prefix) => Object.entries(obj ?? {}).find(([k]) => k.startsWith(prefix))?.[1];
const text = (t) => (t == null ? null : typeof t === "string" ? t : t.LocalizedString ?? t.SourceString ?? t.CultureInvariantString ?? null);
const stripEnum = (v) => (typeof v === "string" ? v.replace(/^[A-Za-z]+::/, "") : v);
const refName = (r) => (r?.ObjectName ? r.ObjectName.split("'")[1] : null); // "IMC_X:Sub_0" or "IA_Move"
const refClass = (r) => (r?.ObjectName ? r.ObjectName.split("'")[0] : null);
const assetName = (p) => p.split("/").pop();

const errors = [];
for (const [pkg, exports] of Object.entries(dump.packages)) {
  if (!Array.isArray(exports)) errors.push({ asset: pkg, message: exports.error });
}
const exportErrors = new Map(); // "pkg|exportName" -> message
for (const e of dump.errors ?? []) {
  const m = /named "([^"]+)"/.exec(e.message);
  if (m) exportErrors.set(`${e.package}|${m[1]}`, e.message);
  if (e.package?.includes("/Core/Input/")) errors.push({ asset: e.package, message: e.message });
}

function subobject(pkg, ref) {
  const name = refName(ref)?.split(":").pop();
  const type = refClass(ref);
  const exp = (dump.packages[pkg] ?? []).find?.((x) => x.Name === name);
  const settings = { ...(DEFAULTS[type] ?? {}), ...(exp?.Properties ?? {}) };
  const out = { type, settings };
  const err = exportErrors.get(`${pkg}|${name}`);
  if (err) {
    out.settings = null;
    out.error = err;
  }
  return out;
}

const contexts = [];
const actions = [];
const blueprintKeyEvents = [];
for (const [pkg, exports] of Object.entries(dump.packages)) {
  if (!Array.isArray(exports)) continue;
  for (const e of exports) {
    const props = e.Properties ?? {};
    if (e.Type === "InputMappingContext") {
      const raw = props.DefaultKeyMappings?.Mappings ?? props.Mappings ?? [];
      contexts.push({
        name: e.Name,
        path: pkg.replace(/^Ballest\/Content/, "/Game"),
        priority: null,
        description: text(props.ContextDescription),
        mappings: raw.map((m) => {
          const mods = (m.Modifiers ?? []).filter(Boolean).map((r) => subobject(pkg, r));
          const trigs = (m.Triggers ?? []).filter(Boolean).map((r) => subobject(pkg, r));
          const pmk = m.PlayerMappableKeySettings ? subobject(pkg, m.PlayerMappableKeySettings).settings : null;
          return {
            action: refName(m.Action),
            key: m.Key?.KeyName ?? null,
            modifiers: mods.map((x) => x.type),
            triggers: trigs.map((x) => x.type),
            modifierSettings: mods,
            triggerSettings: trigs,
            ...(pmk ? { mappable: { name: pmk.Name ?? null, displayName: text(pmk.DisplayName), category: text(pmk.DisplayCategory) } } : {}),
            ...(m.bShouldBeIgnored ? { ignored: true } : {}),
          };
        }),
        ...(Object.keys(props).length === 0 ? { note: "asset has no serialized mappings (empty in the cooked game)" } : {}),
      });
    } else if (e.Type === "InputAction") {
      const mods = (props.Modifiers ?? []).filter(Boolean).map((r) => subobject(pkg, r));
      const trigs = (props.Triggers ?? []).filter(Boolean).map((r) => subobject(pkg, r));
      actions.push({
        name: e.Name,
        path: pkg.replace(/^Ballest\/Content/, "/Game"),
        valueType: stripEnum(props.ValueType ?? "EInputActionValueType::Boolean"),
        description: text(props.ActionDescription),
        consumeInput: props.bConsumeInput ?? true,
        triggerWhenPaused: props.bTriggerWhenPaused ?? false,
        accumulationBehavior: stripEnum(props.AccumulationBehavior ?? "TakeHighestAbsoluteValue"),
        modifiers: mods.map((x) => x.type),
        triggers: trigs.map((x) => x.type),
        modifierSettings: mods,
        triggerSettings: trigs,
      });
    } else if (/Input(Debug)?Key(Delegate)?Binding$|InputActionDelegateBinding$|InputAxisKeyDelegateBinding$/.test(e.Type)) {
      for (const list of Object.values(props))
        for (const b of Array.isArray(list) ? list : []) {
          const chord = b.InputChord ?? b;
          blueprintKeyEvents.push({
            asset: pkg.replace(/^Ballest\/Content/, "/Game"),
            bindingType: e.Type,
            key: chord.Key?.KeyName ?? b.AxisKey?.KeyName ?? b.InputActionName ?? null,
            shift: !!chord.bShift, ctrl: !!chord.bCtrl, alt: !!chord.bAlt, cmd: !!chord.bCmd,
            event: stripEnum(b.InputKeyEvent ?? null),
            function: b.FunctionNameToBind ?? null,
          });
        }
    }
  }
}

// ---- In-game settings sections (UI/MainMenu/Pages/WBP_2_Settings).
// The Controls page is a BallestSettingsScrollBox "Keybinds" whose children alternate
// WBP_OptionsHeader (DesiredText = section title) and a Border holding a VerticalBox named
// <Game|Spectator>Bindings_<MNK|Controller>_VB. The rows (WBP_Keybinding) carry no per-row data:
// the widget graph fills each box at runtime from the player-mappable key profile, filtered by
// PlayerMappableKeySettings.DisplayCategory == "<''|Spectator><MNK|Controller>" (those literals are
// in the widget's bytecode). So section membership is exact; row order within a section is not
// stored in the asset (we list mappings in IMC order).
const settingsPkg = Object.keys(dump.packages).find((k) => k.endsWith("/WBP_2_Settings"));
const sw = Array.isArray(dump.packages[settingsPkg]) ? dump.packages[settingsPkg] : [];
const idxOf = (r) => (r?.ObjectPath ? Number(r.ObjectPath.slice(r.ObjectPath.lastIndexOf(".") + 1)) : -1);
const parentName = (e) => {
  const slot = sw[idxOf(e?.Properties?.Slot)];
  return slot?.Properties?.Parent?.ObjectName?.split(".").pop().replace(/'$/, "") ?? null;
};
const keybindsChildren = sw
  .map((e, i) => [i, e])
  .filter(([, e]) => e.Properties?.Parent?.ObjectName?.endsWith("WidgetTree.Keybinds'"))
  .map(([i, e]) => ({ slotIndex: i, content: sw[idxOf(e.Properties.Content)] }));
const settingsSections = [];
for (const vb of sw.filter((e) => /^(Game|Spectator)Bindings_(MNK|Controller)_VB$/.test(e.Name))) {
  const [, kind, device] = /^(Game|Spectator)Bindings_(MNK|Controller)_VB$/.exec(vb.Name);
  const border = parentName(vb);
  const pos = keybindsChildren.findIndex((c) => c.content?.Name === border);
  let header = null;
  for (let i = pos - 1; i >= 0 && !header; i--) header = keybindsChildren[i].content?.Properties?.DesiredText ?? null;
  settingsSections.push({
    name: text(header),
    order: pos,
    displayCategory: (kind === "Spectator" ? "Spectator" : "") + device,
    widget: vb.Name,
    rowSlots: (vb.Properties?.Slots ?? []).length,
  });
}
settingsSections.sort((a, b) => a.order - b.order);
const sectionByCategory = new Map(settingsSections.map((x) => [x.displayCategory, x.name]));
for (const c of contexts)
  for (const m of c.mappings) {
    m.label = m.mappable?.displayName ?? null;
    m.section = m.mappable ? sectionByCategory.get(m.mappable.category) ?? null : null;
  }
const sections = settingsSections.map((x) => ({
  name: x.name,
  displayCategory: x.displayCategory,
  widget: x.widget,
  rowSlots: x.rowSlots,
  orderNote: "membership exact (DisplayCategory filter); row order is assigned at runtime, listed here in IMC order",
  actions: contexts.flatMap((c) =>
    c.mappings.filter((m) => m.mappable?.category === x.displayCategory).map((m) => ({ label: m.label, action: m.action, key: m.key, context: c.name, mappingName: m.mappable.name })),
  ),
}));
for (const a of actions) {
  const ms = contexts.flatMap((c) => c.mappings.filter((m) => m.action === a.name && m.label));
  a.labels = [...new Set(ms.map((m) => m.label))];
  a.label = a.labels[0] ?? null;
  a.sections = [...new Set(ms.map((m) => m.section).filter(Boolean))];
  a.section = a.sections[0] ?? null;
}

// ---- Camera presets (Core/SaveSystem/Settings/CameraSettings/DT_CameraSettingsPresets, S CameraSettings rows).
const camPkg = Object.keys(dump.packages).find((k) => k.endsWith("/DT_CameraSettingsPresets"));
const camDT = Array.isArray(dump.packages[camPkg]) ? dump.packages[camPkg].find((e) => e.Type === "DataTable") : null;
const cameraPresets = Object.entries(camDT?.Rows ?? {}).map(([row, r]) => ({
  row,
  // Dropdown labels are literal texts in WBP_2_Settings' graph: Default, Wide Angle, Over the Shoulder, Orbital (+ Custom).
  label: row.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^Over The Shoulder$/, "Over the Shoulder"),
  fov: field(r, "FOV_"),
  distance: field(r, "Distance_"),
  height: field(r, "Height_"),
  pitch: field(r, "Pitch_"),
}));

// Legacy input from DefaultInput.ini (+ActionMappings=(...), +AxisMappings=(...), ConsoleKeys).
const ini = Object.entries(dump.files ?? {}).find(([k]) => k.endsWith("DefaultInput.ini"))?.[1] ?? "";
const parseTuple = (s) => Object.fromEntries([...s.matchAll(/(\w+)=("([^"]*)"|[^,)]*)/g)].map((m) => [m[1], m[3] ?? m[2]]));
const legacy = {
  actionMappings: [...ini.matchAll(/^\+ActionMappings=\((.*)\)\s*$/gm)].map((m) => parseTuple(m[1])),
  axisMappings: [...ini.matchAll(/^\+AxisMappings=\((.*)\)\s*$/gm)].map((m) => parseTuple(m[1])),
  consoleKeys: [...ini.matchAll(/^\+ConsoleKeys=(\S+)/gm)].map((m) => m[1]),
  defaultInputComponentClass: /^DefaultInputComponentClass=(\S+)/m.exec(ini)?.[1] ?? null,
};

contexts.sort((a, b) => a.name.localeCompare(b.name));
actions.sort((a, b) => a.name.localeCompare(b.name));
const out = {
  version: 1,
  source: "Ballest-Windows pak: /Game/Core/Input (Enhanced Input), Ballest/Config/DefaultInput.ini, level-editor widgets/controller",
  notes: [
    "priority is not stored in UInputMappingContext; it is chosen at AddMappingContext() time in Blueprint/C++ and is null here.",
    "modifierSettings/triggerSettings are effective values: UE 5.8 class defaults merged with the cooked overrides. settings=null means the subobject could not be parsed (see error); Ballest* modifier classes are game-native and need the game's own .usmap.",
    "IMC_LevelEditor, IMC_ModeEditor, IMC_MainMenu, IMC_ModeRace and IMC_Paused are empty in the cooked game, and IA_Translate/IA_Rotate/IA_Scale/IA_Coordinates are not mapped by any context. The level editor's own shortcuts (gizmo modes, snapping, delete, undo...) are handled in native code (SKGMultiplayerLevelEditor C++ plugin; e.g. USKGMLEGizmoDeveloperSettings::ToggleGizmoVisibilityKey) whose defaults are compiled into the exe, not stored in the pak. The [/Script/SKGMultiplayerLevelEditor.SKGMLEDeveloperSettings] section of DefaultGame.ini is empty, so the compiled defaults apply.",
    "label = PlayerMappableKeySettings.DisplayName (what the Controls page shows; the UI lowercases it). section = the Controls-page header the mapping is listed under (mapping DisplayCategory -> WBP_2_Settings header). sections[].actions order within a section is not stored in the assets (rows are filled at runtime), so it is IMC order.",
    "cameraPresets come from DT_CameraSettingsPresets (fov in degrees, distance/height in cm). The dropdown also offers 'Custom' (current slider values).",
    "blueprintKeyEvents are raw key events compiled into Blueprints (InputDebugKey events only fire in non-shipping builds).",
  ],
  sections,
  cameraPresets,
  contexts,
  actions,
  legacy,
  blueprintKeyEvents,
  errors,
};
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.error(`[keybinds] ${contexts.length} contexts (${contexts.filter((c) => c.mappings.length).length} non-empty, ${contexts.reduce((n, c) => n + c.mappings.length, 0)} mappings), ${actions.length} actions, ${blueprintKeyEvents.length} BP key events, ${errors.length} errors`);
