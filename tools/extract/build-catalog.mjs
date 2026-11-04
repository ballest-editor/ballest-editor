#!/usr/bin/env node
// usage:
//   node build-catalog.mjs classes WORK ASSETS_DIR -> WORK/classes.txt + WORK/thumbs.txt
//        (sample classes + every level-editor item the recipe registry/palette references)
//   node build-catalog.mjs meshes  WORK            -> WORK/meshes.txt (meshes to export)
//   node build-catalog.mjs catalog WORK ASSETS_DIR -> ASSETS_DIR/catalog.json
// Inputs: WORK/samples.json (scan-samples.mjs), ASSETS_DIR/registry.json (build-registry.mjs),
// WORK/classes.json + meshes.json + thumbs.json (BallestExtract).
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { MIRROR_DIR, pairMirrors } from "./mirrors.mjs"

const [mode, work, assets] = process.argv.slice(2)
const readJson = (f) => JSON.parse(readFileSync(join(work, f), "utf8"))
const samples = readJson("samples.json")

// Ordered piece list: palette order (category by category), then registry-only items
// (alphabetical), then any sampled class that is in neither.
function pieceOrder(registry) {
  const order = []
  const info = new Map()
  for (const cat of registry.palette) {
    for (const it of cat.items) {
      if (it.class && !info.has(it.class)) {
        order.push(it.class)
        info.set(it.class, { category: cat.category, displayName: it.name ?? null, thumbnail: it.thumbnail ?? null })
      }
    }
  }
  const items = new Map(registry.levelEditorItems.map((i) => [i.class, i]))
  const reg = new Set(registry.recipeRegistry.referencedItemClasses)
  for (const cp of [...reg].sort((a, b) => a.split(".").pop().localeCompare(b.split(".").pop()))) {
    if (!info.has(cp) && items.has(cp)) (order.push(cp), info.set(cp, {}))
  }
  for (const c of samples.classes) if (!info.has(c.objectPath)) (order.push(c.objectPath), info.set(c.objectPath, {}))
  return order.map((cp) => ({
    objectPath: cp,
    inRegistry: reg.has(cp),
    isItem: items.get(cp)?.isLevelEditorItem ?? null,
    ...info.get(cp)
  }))
}

if (mode === "classes") {
  const registry = JSON.parse(readFileSync(join(assets, "registry.json"), "utf8"))
  const order = pieceOrder(registry)
  writeFileSync(join(work, "classes.txt"), order.map((p) => p.objectPath).join("\n") + "\n")
  writeFileSync(join(work, "thumbs.txt"), order.filter((p) => p.thumbnail).map((p) => p.thumbnail).join("\n") + "\n")
  console.error(
    `[catalog] ${order.length} classes (${order.filter((p) => p.category).length} in palette), ${
      order.filter((p) => p.thumbnail).length
    } thumbnails`
  )
  process.exit(0)
}
const classes = new Map(readJson("classes.json").map((c) => [c.classPath, c]))
const mostCommon = (counts) => Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0]

if (mode === "meshes") {
  const set = new Set()
  for (const c of samples.classes) for (const m of Object.keys(c.meshes)) if (m.startsWith("/")) set.add(m)
  for (const c of classes.values()) for (const m of c.meshComponents ?? []) if (m.staticMesh) set.add(m.staticMesh)
  writeFileSync(join(work, "meshes.txt"), [...set].sort().join("\n") + "\n")
  console.error(`[catalog] ${set.size} meshes referenced by samples/classes`)
  process.exit(0)
}
if (mode !== "catalog" || !assets) {
  console.error("usage: build-catalog.mjs meshes WORK | catalog WORK ASSETS_DIR")
  process.exit(2)
}

const meshes = new Map(readJson("meshes.json").filter((m) => !m.skipped).map((m) => [m.meshAssetPath, m]))
const glbPath = (m) => (m?.glb ? `pieces/${m.glb}` : null)
const meshError = (p) => meshes.get(p)?.error ?? (meshes.has(p) ? null : "not exported")

const slotsFor = (meshPath, overrides = []) =>
  (meshes.get(meshPath)?.materialSlots ?? []).map((s) => ({
    index: s.index,
    slotName: s.slotName,
    defaultMaterial: overrides[s.index] ?? s.defaultMaterial,
    meshMaterial: s.defaultMaterial
  }))

// Blueprint property type -> the typed list and propertyType the game writes into map files.
const PROPERTY_KINDS = {
  BoolProperty: { list: "boolProperties", type: "Bool", zero: false },
  FloatProperty: { list: "floatProperties", type: "Float", zero: 0 },
  DoubleProperty: { list: "floatProperties", type: "Float", zero: 0 },
  IntProperty: { list: "intProperties", type: "Integer", zero: 0 }
}

// The item properties the level editor exposes, in the game's order, with their defaults.
// Most classes list them in their CDO (LevelEditorExposedProperties). Some (the shape decal,
// the light cards) expose them from native code instead; for those, the properties the game
// wrote into the samples give the names and order, and the Blueprint variables the defaults.
// A type with no known list (native, enum, ...) keeps list/type null; the app only shows those.
const propertiesOf = (cls, sample) => {
  const props = cls?.levelEditorProperties
  if (!props) return []
  const hidden = new Set(props.hidden)
  const variables = new Map((props.variables ?? []).map((v) => [v.name, v]))
  const entry = (p, source) => {
    const kind = PROPERTY_KINDS[p.ueType]
    return {
      name: p.name,
      list: kind?.list ?? null,
      type: kind?.type ?? null,
      ueType: p.ueType ?? null,
      default: p.default ?? kind?.zero ?? null,
      hidden: hidden.has(p.name),
      source
    }
  }
  if (props.exposed.length > 0) return props.exposed.map((p) => entry(p, "cdo"))
  return (sample?.properties ?? []).map((p) => {
    const variable = variables.get(p.name)
    const built = entry({ name: p.name, ueType: variable?.ueType, default: variable?.default }, "samples")
    // the game's own list and type win; a mismatch with the Blueprint drops the default
    const agrees = built.list === p.list && built.type === p.type
    return { ...built, list: p.list, type: p.type, default: agrees ? built.default : null }
  })
}

// Item properties 0.4.1's native code saves beside a class's own, from the "new pieces probe" draft saved in game
// on 2026-11-02 (samples/UserSavedMaps): SurfaceAssignment (Integer: 0 none, 1 magnet, 2 ice, 3 grippy) after the
// class's own ints on every item, the player start and goal included; Mirror Y and Mirror X as bMirror and bMirrorX
// after its own bools, except on the player start and checkpoints, and only bMirrorX on a physics prop with its own
// PhysicsFlip. A class a 0.4.1 save shows keeps exactly the layout the game wrote. On the others these follow the
// rule above and are `optional`: the game rejects an item carrying a property its class doesn't have, and loads one
// without them (every 0.4.0 map), so new items leave them out until they're set.
const NATIVE = {
  SurfaceAssignment: { list: "intProperties", type: "Integer", default: 0 },
  bMirror: { list: "boolProperties", type: "Bool", default: false },
  bMirrorX: { list: "boolProperties", type: "Bool", default: false }
}
const CHECKPOINT_BASE = "/Game/Core/Gameplay/MapTriggers/BP_ActualCheckpointBase.BP_ActualCheckpointBase_C"
// Defaults native code sets over the Blueprint's. The point light's shadows are off when it's placed from the palette
// (the "new pieces probe", placed by hand; BallestUGCLightComponent's bDisableShadowsOnNewPlacement), though one a map
// loads or a paste makes saves them on. The rest are what the palette and hidden probes saved for an untouched item.
const REACH = { LightAttenuationRadius: 1000 }
const DEFAULT_OVERRIDES = {
  MP_RawPointLight: { bLightCastsShadows: false, ...REACH },
  MP_RawSpotLight: REACH,
  MP_RawRectLight: REACH,
  MP_PointLightFixture: REACH,
  MP_SpotLightFixture: REACH,
  BP_Surface_Magnet: { SurfaceAssignment: 1 },
  BP_Surface_Ice: { SurfaceAssignment: 2 },
  BP_Surface_Grippy: { SurfaceAssignment: 3 }
}

const nativeEntry = (name, optional) => ({
  name,
  ...NATIVE[name],
  ueType: null,
  hidden: false,
  source: "native",
  ...(optional ? { optional: true } : {})
})

const withNative = (own, className, chain, sample) => {
  const overrides = DEFAULT_OVERRIDES[className] ?? {}
  if (sample?.savedBy041) {
    // The layout a 0.4.1 save shows: its names, lists and order; defaults from the class or the native table.
    const byName = new Map(own.map((p) => [p.name, p]))
    return sample.properties.map((p) => {
      const known = NATIVE[p.name] ? nativeEntry(p.name, false) : byName.get(p.name)
      const entry = known ?? { name: p.name, ueType: null, default: null, hidden: false, source: "samples" }
      const agrees = entry.list === p.list && entry.type === p.type
      return {
        ...entry,
        list: p.list,
        type: p.type,
        default: p.name in overrides ? overrides[p.name] : agrees ? entry.default : null
      }
    })
  }
  const mirror = className === "MP_PlayerStart" || chain.includes(CHECKPOINT_BASE)
    ? []
    : own.some((p) => p.name === "PhysicsFlip")
    ? ["bMirrorX"]
    : ["bMirror", "bMirrorX"]
  return [
    ...own.map((p) => (p.name in overrides ? { ...p, default: overrides[p.name] } : p)),
    ...[...mirror, "SurfaceAssignment"].map((name) => nativeEntry(name, true))
  ]
}

// What the game's details panel offers on a class, measured in game (panel.json; docs/qa/exposed-properties.md). Native
// code decides this at runtime (BallestUGCPropertyDisplayLibrary), so the pak can't show it. A property with no row is
// saved but not offered: hidden. Flip Y is PhysicsFlip on a class that has it, bMirror on the rest.
const panel = JSON.parse(readFileSync(join(import.meta.dirname, "panel.json"), "utf8"))
const SURFACE_OPTIONS = [
  { value: 0, label: "Default" },
  { value: 1, label: "Magnet" },
  { value: 3, label: "Grippy" },
  { value: 2, label: "Ice" }
]
const FIRST_ROW = 3
const panelControls = (entry) => ({
  bMirrorX: entry.flip === false ? null : { label: "Flip X", control: "toggle", row: 0 },
  bMirror: entry.flip === false ? null : { label: "Flip Y", control: "toggle", row: 1 },
  PhysicsFlip: entry.flip === false ? null : { label: "Flip Y", control: "toggle", row: 1 },
  SurfaceAssignment: entry.surface === false
    ? null
    : { label: "Surfaces", control: "dropdown", row: 2, options: SURFACE_OPTIONS }
})

const withPanel = (properties, className) => {
  const entry = panel.pieces[className]
  // MP_PinballPaddle: 0.4.1 removed it, so there's no panel to measure.
  if (entry === undefined) return properties
  const rows = new Map(
    (panel.rowSets[entry.rows] ?? []).flatMap(({ name, names, ...row }, i) =>
      (names ?? [name]).map((n) => [n, { ...row, row: FIRST_ROW + i }])
    )
  )
  const controls = panelControls(entry)
  const listed = new Set(properties.map((p) => p.name))
  for (const name of rows.keys()) {
    if (!listed.has(name)) throw new Error(`panel.json: ${className} has no property ${name}`)
  }
  return properties.map((p) => {
    const shown = rows.get(p.name) ?? controls[p.name]
    return shown ? { ...p, ...shown, hidden: false } : { ...p, hidden: true }
  })
}

// Components native code places at runtime: BallestElevatorComponent drives the platform, so the cooked templates say
// nothing about where it sits (the Platform template is scaled 17.7 x 17.7, a 22 m disc over the 3 m base). These are
// the components' RelativeLocation and RelativeScale3D in a placed elevator, read from the running game with the game
// driver: the platform's mesh, whose skirt reaches 65 cm down at scale 1, is squashed into the base.
const NATIVE_TRANSFORMS = {
  BP_Elevator: {
    Platform: { location: [0, 0, 6.9114], scale: [0.9786, 0.9786, 0.216] },
    StretchExtension: { location: [0, 0, -7.0898], scale: [0.6, 0.6, 0.001] }
  }
}
const nativeTransform = (className, component, transform) => {
  const native = NATIVE_TRANSFORMS[className]?.[component]
  return native ? { ...transform, ...native } : transform
}

// A laser's beam: BallestLaserBeamMeshComponents (core and glow) native code builds along the trace from the
// terminal's muzzle, so there is no mesh to export. Its radii are the Blueprint's (LaserCoreRadius,
// LaserGlowRadius); the colour is M_LaserBeamCore's LaserColor default. The beam leaves the terminal's front
// face (the mesh's +X side) along +X. Its length is SM_LaserCore's (a 100 cm unit cylinder): the laser's only
// scalable axis is X (ScalableAxes), which stretches it, and the game's thumbnail shows a beam about 1 m long.
const LASER_COLOR = [1, 0.015494804, 0.015494804]
const LASER_LENGTH = 100
const beamOf = (cls, mesh) => {
  const variable = (name) => cls?.levelEditorProperties?.variables?.find((v) => v.name === name)?.default
  const coreRadius = variable("LaserCoreRadius"), glowRadius = variable("LaserGlowRadius")
  if (typeof coreRadius !== "number" || typeof glowRadius !== "number") return undefined
  return {
    muzzle: [mesh?.bounds?.max?.[0] ?? 0, 0, 0],
    axis: [1, 0, 0],
    length: LASER_LENGTH,
    coreRadius,
    glowRadius,
    color: LASER_COLOR
  }
}

// Whether the level editor's Paint panel lists a piece. W_ItemsDatas.CreateItemList takes a selected BP_BaseItem only
// if its bCanChangeMaterial is set, and W_MeshMaterialData.SetMaterialSlots builds no row for a class it can't name
// from DT_MapItems: the palette. BP_BaseItem's CDO sets the flag, so the classes that lock their paint are the ones
// whose CDO saves it false; a null default means the class left it alone. Without the variable it isn't a BP_BaseItem.
// The light cards save it false too, but past LightCardVisualContract, a native struct the Fortnite usmap doesn't
// have, so their CDOs stop reading before it; the game's own usmap (tools/driver types_dump) shows it. Those four are
// the only classes the two usmaps disagree on.
const PAINT_LOCKED_PAST_NATIVE = new Set(["MP_LightCard_01", "MP_LightCard_02", "MP_LightCard_03", "MP_LightCard_04"])
const paintableOf = (cls, className, inPalette) => {
  const variable = cls?.levelEditorProperties?.variables?.find((v) => v.name === "bCanChangeMaterial")
  return inPalette && variable !== undefined && variable.default !== false && !PAINT_LOCKED_PAST_NATIVE.has(className)
}

// Slots of the pieces above that a map file can paint anyway. Only playing the map shows which: the game overwrites
// some slots and never draws others, so the table is measured (docs/qa/materials.md).
const offPanelPaint = new Map(
  JSON.parse(readFileSync(join(import.meta.dirname, "paint-measured.json"), "utf8")).pieces
    .flatMap((p) => (p.offPanel === undefined ? [] : [[p.classPath, p.offPanel]]))
)

const pieces = []
const unresolved = []
const registry = JSON.parse(readFileSync(join(assets, "registry.json"), "utf8"))
const chainOf = new Map(registry.levelEditorItems.map((i) => [i.class, i.parentChain]))
const thumbs = (() => {
  try {
    return readJson("thumbs.json")
  } catch {
    return {}
  }
})()
const sampleByPath = new Map(samples.classes.map((c) => [c.objectPath, c]))
for (const o of pieceOrder(registry)) {
  const s = sampleByPath.get(o.objectPath) ?? {
    classPath: `/Script/Engine.BlueprintGeneratedClass'${o.objectPath}'`,
    objectPath: o.objectPath,
    className: o.objectPath.split(".").pop(),
    seenInSamples: 0,
    meshes: {},
    materials: {},
    propertyNames: {}
  }
  const cls = classes.get(s.objectPath)
  const main = cls?.meshComponents?.find((m) => m.name === "Main")
  const sampleMesh = mostCommon(s.meshes) || null
  // Prefer the pak (Main component template); fall back to what the game wrote into saved maps.
  const meshAssetPath = main ? main.staticMesh : sampleMesh
  const mesh = meshAssetPath ? meshes.get(meshAssetPath) : null
  const piece = {
    classPath: s.classPath,
    className: s.className.replace(/_C$/, ""),
    objectPath: s.objectPath,
    category: o.category ?? null,
    displayName: o.displayName ?? null,
    inPalette: !!o.category,
    inRegistry: o.inRegistry,
    thumbnail: o.thumbnail && thumbs[o.thumbnail]?.png ? `thumbs/${thumbs[o.thumbnail].png}` : null,
    meshAssetPath,
    glb: glbPath(mesh),
    materialSlots: meshAssetPath ? slotsFor(meshAssetPath, main?.overrideMaterials) : [],
    paintable: paintableOf(cls, s.className.replace(/_C$/, ""), !!o.category),
    ...(offPanelPaint.has(s.objectPath) ? { offPanelPaint: offPanelPaint.get(s.objectPath) } : {}),
    bounds: mesh?.bounds ?? null,
    seenInSamples: s.seenInSamples,
    meshSource: main ? "pak" : sampleMesh ? "samples" : null,
    sampleMeshAssetPath: sampleMesh,
    mainRelativeTransform: main?.relative ?? null,
    extraMeshes: (cls?.meshComponents ?? [])
      .filter((m) => m.name !== "Main" && m.staticMesh)
      .map((m) => ({
        name: m.name,
        meshAssetPath: m.staticMesh,
        glb: glbPath(meshes.get(m.staticMesh)),
        visible: m.visible,
        hiddenInGame: m.hiddenInGame,
        transformRelativeToMain: nativeTransform(s.className.replace(/_C$/, ""), m.name, m.mainSpace),
        materialSlots: slotsFor(m.staticMesh, m.overrideMaterials),
        bounds: meshes.get(m.staticMesh)?.bounds ?? null
      })),
    ...(beamOf(cls, mesh) ? { beam: beamOf(cls, mesh) } : {}),
    sampleProperties: Object.keys(s.propertyNames).sort(),
    properties: withPanel(
      withNative(propertiesOf(cls, s), s.className.replace(/_C$/, ""), chainOf.get(s.objectPath) ?? [], s),
      s.className.replace(/_C$/, "")
    )
  }
  if (cls?.error) piece.classError = cls.error
  if (!meshAssetPath) {
    piece.note = piece.extraMeshes.length
      ? "Main component has no mesh; visuals come from extraMeshes"
      : "no mesh found"
    if (!piece.extraMeshes.length) {
      unresolved.push({
        classPath: s.classPath,
        reason: cls?.error?.includes("There is no game file")
          ? "removed from the game: its Blueprint is no longer in the game's files, so maps using it won't load"
          : cls?.error
          ? `class: ${cls.error}`
          : "no StaticMeshComponent with a mesh (light/volume/decal-only actor, or visuals created in native code)"
      })
    }
  } else if (!piece.glb) {
    unresolved.push({ classPath: s.classPath, meshAssetPath, reason: meshError(meshAssetPath) })
  }
  pieces.push(piece)
}

const mirrored = pairMirrors([...meshes.values()], join(work, "pieces"))
// Materials the game swaps when it mirrors an item, by slot (the probe's spinning cylinder: Mirror X kept its
// mesh and turned its cap to the flipped one, which shows the spin the other way round).
const CYLINDER_CAPS = "/Game/LevelEditor/PackageAssets/BallestAssets/PhysicsProps/Materials/Surfaces/SpinningCylinder"
const MIRROR_MATERIALS = [{
  material: `${CYLINDER_CAPS}/MI_SpinningCylinderCap_Normal.MI_SpinningCylinderCap_Normal`,
  mirrored: `${CYLINDER_CAPS}/MI_SpinningCylinderCap_Flipped.MI_SpinningCylinderCap_Flipped`
}]

const catalog = {
  version: 1,
  game: "Ballest of Them All 0.4.1 (UE 5.8, ++UE5+Release-5.8-CL-56702186)",
  units: "cm",
  coordinateSystem:
    "Unreal native: left-handed, +X forward, +Y right, +Z up. glb files are NOT converted to glTF Y-up.",
  transformNote:
    "itemTransform in map files is the world transform of the Main component; extraMeshes[].transformRelativeToMain is relative to that.",
  pieces,
  unresolved,
  mirrors: {
    note:
      "Mirror X / Mirror Y (bMirrorX / bMirror) negate the item's local x / y. An item mirrored on one axis saves its mesh as the baked copy here (mirrorMeshAssetPath; axes = the local axis the bake negates, xy for a symmetric source); on both, or on none, the original. Pairs are matched by geometry (tools/extract/mirrors.mjs); the bakes themselves aren't exported. materials: slot materials the game swaps on a mirrored item.",
    meshes: mirrored.pairs,
    unpaired: mirrored.unpaired,
    materials: MIRROR_MATERIALS
  },
  meshes: [...meshes.values()]
    .filter((m) => m.glb && !m.meshAssetPath.startsWith(MIRROR_DIR))
    .map((m) => ({
      meshAssetPath: m.meshAssetPath,
      glb: glbPath(m),
      vertices: m.vertices,
      triangles: m.triangles,
      bounds: m.bounds,
      materialSlots: m.materialSlots
    }))
    .sort((a, b) => a.meshAssetPath.localeCompare(b.meshAssetPath)),
  meshErrors: [...meshes.values()].filter((m) => m.error).map((m) => ({
    meshAssetPath: m.meshAssetPath,
    error: m.error
  }))
}
writeFileSync(join(assets, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n")
console.error(
  `[catalog] ${pieces.length} pieces, ${unresolved.length} unresolved, ${catalog.meshes.length} meshes, ${catalog.meshErrors.length} mesh errors, ${mirrored.pairs.length} mirror pairs (${mirrored.unpaired.length} bakes unpaired)`
)
