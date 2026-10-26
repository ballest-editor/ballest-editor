#!/usr/bin/env node
// usage:
//   node build-catalog.mjs classes WORK ASSETS_DIR -> WORK/classes.txt + WORK/thumbs.txt
//        (sample classes + every level-editor item the recipe registry/palette references)
//   node build-catalog.mjs meshes  WORK            -> WORK/meshes.txt (meshes to export)
//   node build-catalog.mjs catalog WORK ASSETS_DIR -> ASSETS_DIR/catalog.json
// Inputs: WORK/samples.json (scan-samples.mjs), ASSETS_DIR/registry.json (build-registry.mjs),
// WORK/classes.json + meshes.json + thumbs.json (BallestExtract).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [mode, work, assets] = process.argv.slice(2);
const readJson = (f) => JSON.parse(readFileSync(join(work, f), "utf8"));
const samples = readJson("samples.json");

// Ordered piece list: palette order (category by category), then registry-only items
// (alphabetical), then any sampled class that is in neither.
function pieceOrder(registry) {
  const order = [];
  const info = new Map();
  for (const cat of registry.palette)
    for (const it of cat.items)
      if (it.class && !info.has(it.class)) {
        order.push(it.class);
        info.set(it.class, { category: cat.category, displayName: it.name ?? null, thumbnail: it.thumbnail ?? null });
      }
  const items = new Map(registry.levelEditorItems.map((i) => [i.class, i]));
  const reg = new Set(registry.recipeRegistry.referencedItemClasses);
  for (const cp of [...reg].sort((a, b) => a.split(".").pop().localeCompare(b.split(".").pop())))
    if (!info.has(cp) && items.has(cp)) (order.push(cp), info.set(cp, {}));
  for (const c of samples.classes) if (!info.has(c.objectPath)) (order.push(c.objectPath), info.set(c.objectPath, {}));
  return order.map((cp) => ({ objectPath: cp, inRegistry: reg.has(cp), isItem: items.get(cp)?.isLevelEditorItem ?? null, ...info.get(cp) }));
}

if (mode === "classes") {
  const registry = JSON.parse(readFileSync(join(assets, "registry.json"), "utf8"));
  const order = pieceOrder(registry);
  writeFileSync(join(work, "classes.txt"), order.map((p) => p.objectPath).join("\n") + "\n");
  writeFileSync(join(work, "thumbs.txt"), order.filter((p) => p.thumbnail).map((p) => p.thumbnail).join("\n") + "\n");
  console.error(`[catalog] ${order.length} classes (${order.filter((p) => p.category).length} in palette), ${order.filter((p) => p.thumbnail).length} thumbnails`);
  process.exit(0);
}
const classes = new Map(readJson("classes.json").map((c) => [c.classPath, c]));
const mostCommon = (counts) => Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];

if (mode === "meshes") {
  const set = new Set();
  for (const c of samples.classes) for (const m of Object.keys(c.meshes)) if (m.startsWith("/")) set.add(m);
  for (const c of classes.values()) for (const m of c.meshComponents ?? []) if (m.staticMesh) set.add(m.staticMesh);
  writeFileSync(join(work, "meshes.txt"), [...set].sort().join("\n") + "\n");
  console.error(`[catalog] ${set.size} meshes referenced by samples/classes`);
  process.exit(0);
}
if (mode !== "catalog" || !assets) {
  console.error("usage: build-catalog.mjs meshes WORK | catalog WORK ASSETS_DIR");
  process.exit(2);
}

const meshes = new Map(readJson("meshes.json").filter((m) => !m.skipped).map((m) => [m.meshAssetPath, m]));
const glbPath = (m) => (m?.glb ? `pieces/${m.glb}` : null);
const meshError = (p) => meshes.get(p)?.error ?? (meshes.has(p) ? null : "not exported");

const slotsFor = (meshPath, overrides = []) =>
  (meshes.get(meshPath)?.materialSlots ?? []).map((s) => ({
    index: s.index,
    slotName: s.slotName,
    defaultMaterial: overrides[s.index] ?? s.defaultMaterial,
    meshMaterial: s.defaultMaterial,
  }));

const pieces = [];
const unresolved = [];
const registry = JSON.parse(readFileSync(join(assets, "registry.json"), "utf8"));
const thumbs = (() => { try { return readJson("thumbs.json"); } catch { return {}; } })();
const sampleByPath = new Map(samples.classes.map((c) => [c.objectPath, c]));
for (const o of pieceOrder(registry)) {
  const s = sampleByPath.get(o.objectPath) ?? {
    classPath: `/Script/Engine.BlueprintGeneratedClass'${o.objectPath}'`,
    objectPath: o.objectPath,
    className: o.objectPath.split(".").pop(),
    seenInSamples: 0,
    meshes: {},
    materials: {},
    propertyNames: {},
  };
  const cls = classes.get(s.objectPath);
  const main = cls?.meshComponents?.find((m) => m.name === "Main");
  const sampleMesh = mostCommon(s.meshes) || null;
  // Prefer the pak (Main component template); fall back to what the game wrote into saved maps.
  const meshAssetPath = main ? main.staticMesh : sampleMesh;
  const mesh = meshAssetPath ? meshes.get(meshAssetPath) : null;
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
        transformRelativeToMain: m.mainSpace,
        materialSlots: slotsFor(m.staticMesh, m.overrideMaterials),
        bounds: meshes.get(m.staticMesh)?.bounds ?? null,
      })),
    sampleProperties: Object.keys(s.propertyNames).sort(),
  };
  if (cls?.error) piece.classError = cls.error;
  if (!meshAssetPath) {
    piece.note = piece.extraMeshes.length
      ? "Main component has no mesh; visuals come from extraMeshes"
      : "no mesh found";
    if (!piece.extraMeshes.length)
      unresolved.push({ classPath: s.classPath, reason: cls?.error ? `class: ${cls.error}` : "no StaticMeshComponent with a mesh (light/volume/decal-only actor, or visuals created in native code)" });
  } else if (!piece.glb) {
    unresolved.push({ classPath: s.classPath, meshAssetPath, reason: meshError(meshAssetPath) });
  }
  pieces.push(piece);
}

const catalog = {
  version: 1,
  game: "Ballest of Them All 0.4.0-playtest (UE 5.8, ++UE5+Release-5.8-CL-56702186)",
  units: "cm",
  coordinateSystem: "Unreal native: left-handed, +X forward, +Y right, +Z up. glb files are NOT converted to glTF Y-up.",
  transformNote: "itemTransform in map files is the world transform of the Main component; extraMeshes[].transformRelativeToMain is relative to that.",
  pieces,
  unresolved,
  meshes: [...meshes.values()]
    .filter((m) => m.glb)
    .map((m) => ({
      meshAssetPath: m.meshAssetPath,
      glb: glbPath(m),
      vertices: m.vertices,
      triangles: m.triangles,
      bounds: m.bounds,
      materialSlots: m.materialSlots,
    }))
    .sort((a, b) => a.meshAssetPath.localeCompare(b.meshAssetPath)),
  meshErrors: [...meshes.values()].filter((m) => m.error).map((m) => ({ meshAssetPath: m.meshAssetPath, error: m.error })),
};
writeFileSync(join(assets, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
console.error(`[catalog] ${pieces.length} pieces, ${unresolved.length} unresolved, ${catalog.meshes.length} meshes, ${catalog.meshErrors.length} mesh errors`);
