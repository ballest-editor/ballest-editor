#!/usr/bin/env node
// Build assets/registry.json: which item classes the game knows about.
// usage: node build-registry.mjs WORK ASSETS_DIR
// Inputs (WORK): imports.json (BallestExtract imports, all of Ballest/Content),
// palette-dump.json (BallestExtract dump of the ContentBrowser data), samples.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [work, assets] = process.argv.slice(2);
if (!assets) {
  console.error("usage: build-registry.mjs WORK ASSETS_DIR");
  process.exit(2);
}
const readJson = (f) => JSON.parse(readFileSync(join(work, f), "utf8"));
const imports = readJson("imports.json");
const palette = readJson("palette-dump.json");
const samples = readJson("samples.json");

const gamePath = (file) => "/Game/" + file.slice("Ballest/Content/".length);
const BASE_ITEM = "/Game/LevelEditor/PackageAssets/MultiplayerLevelEditor/ExampleObjects/BP_BaseItem.BP_BaseItem_C";
const REGISTRY = "/Game/LevelEditor/Playback/DA_UGCPlaybackRecipeRegistry";

// Blueprint class hierarchy from export maps (works without property mappings).
const parent = new Map();
const classOfPackage = new Map();
for (const [file, v] of Object.entries(imports))
  for (const e of v.exports ?? [])
    if (/BlueprintGeneratedClass$/.test(e.class ?? "")) {
      const cp = `${gamePath(file)}.${e.name}`;
      parent.set(cp, e.super);
      classOfPackage.set(gamePath(file), cp);
    }
const chainOf = (cp) => {
  const out = [];
  for (let c = parent.get(cp); c && out.length < 32; c = parent.get(c)) out.push(c);
  return out;
};
const isItem = (cp) => chainOf(cp).includes(BASE_ITEM);
const refsOf = (pkg) => {
  const v = imports[`Ballest/Content${pkg.slice(5)}`] ?? {};
  return new Set([...(v.namePaths ?? []), ...(v.imports ?? []).map((i) => i.path.split(".")[0])]);
};

// Palette: DT_MapItems rows -> PDA_MapItem data assets -> Items[] {Name, Thumbnail, Class}.
const cb = palette.packages;
const field = (obj, prefix) => Object.entries(obj ?? {}).find(([k]) => k.startsWith(prefix))?.[1];
const refPath = (r) => (r?.ObjectName ? `${r.ObjectPath.slice(0, r.ObjectPath.lastIndexOf("."))}.${r.ObjectName.split("'")[1]}` : null);
const dtFile = Object.keys(cb).find((k) => k.endsWith("/DT_MapItems"));
const dt = cb[dtFile]?.find?.((e) => e.Type === "DataTable");
const paletteCats = Object.entries(dt?.Rows ?? {}).map(([row, r]) => {
  const daPath = field(r, "DataAsset")?.AssetPathName ?? null;
  const daFile = daPath && `Ballest/Content${daPath.split(".")[0].slice(5)}`;
  const da = cb[daFile]?.find?.((e) => e.Type === "PDA_MapItem_C");
  return {
    row,
    category: field(r, "Category"),
    dataAsset: daPath,
    items: (da?.Properties?.Items ?? []).map((it) => ({
      name: field(it, "Name_"),
      class: refPath(field(it, "Class_")),
      thumbnail: refPath(field(it, "Thumbnail_")),
    })),
  };
});
const paletteClasses = new Map();
paletteCats.forEach((c) => c.items.forEach((it) => it.class && paletteClasses.set(it.class, { category: c.category, name: it.name })));
// PDA_MapItem assets that exist but are not reachable from DT_MapItems.
const orphanDAs = Object.entries(cb)
  .filter(([f, ex]) => Array.isArray(ex) && !f.endsWith("/PDA_MapItem") && ex.some((e) => e.Type === "PDA_MapItem_C"))
  .map(([f]) => gamePath(f))
  .filter((p) => !paletteCats.some((c) => c.dataAsset?.startsWith(p + ".")));

// Recipe registry (native class; properties need the game's usmap -> only its name map/imports).
const regEntry = imports[`Ballest/Content${REGISTRY.slice(5)}`] ?? {};
const regRefs = refsOf(REGISTRY);

const seen = new Map(samples.classes.map((c) => [c.objectPath, c.seenInSamples]));
const items = [...classOfPackage.values()].filter(isItem).sort();
const referencers = new Map();
for (const [file, v] of Object.entries(imports)) {
  const refs = new Set([...(v.namePaths ?? []), ...(v.imports ?? []).map((i) => i.path.split(".")[0])]);
  for (const cp of items) {
    const pkg = cp.split(".")[0];
    if (refs.has(pkg) && gamePath(file).split(".")[0] !== pkg) (referencers.get(cp) ?? referencers.set(cp, []).get(cp)).push(gamePath(file));
  }
}
const describe = (cp) => {
  const pkg = cp.split(".")[0];
  return {
    class: cp,
    isLevelEditorItem: isItem(cp),
    parentChain: chainOf(cp),
    inPalette: paletteClasses.has(cp),
    palette: paletteClasses.get(cp) ?? null,
    inRecipeRegistry: regRefs.has(pkg),
    seenInSamples: seen.get(cp) ?? 0,
    referencedBy: (referencers.get(cp) ?? []).filter((p) => !p.startsWith(REGISTRY)).sort(),
  };
};

// Candidate pieces asked about (names -> class paths by package basename).
const CANDIDATES = [
  "MP_PointLightFixture", "MP_RawPointLight", "MP_RawRectLight", "MP_RawSpotLight", "MP_SpotLightFixture",
  "MP_LightCard_01", "MP_LightCard_02", "MP_LightCard_03", "MP_LightCard_04", "MP_LaserTerminal", "MP_OrangeSign",
  "MP_BoostPlatform", "MP_BoostRing", "MP_BoostVolume", "MP_PinballLauncher", "MP_PinballPaddle",
  "BP_CircularFlexiblePlatform", "BP_KillZone", "BP_UGCShapeDecal", "MP_CheckpointStrip", "MP_ActualCheckpoint_Disc",
  "BP_Bowl_Shallow", "BP_Track_Curve_Tiny1", "Bevel_Tall_Branch", "Bevel_Tall_Cap", "Bevel_Tall_CornerConcave",
  "Bevel_Tall_SheerStraight", "Bevel_Tall_StraightWall", "Bevel_Full_Cap", "Bevel_Full_HalfRing", "Bevel_Full_ShortScoop",
  "Bevel_Half_ConcaveCornerCurveFlat", "Bevel_Half_DeepScoop", "Bevel_Half_MediumRamp", "Bevel_Half_ShallowCornerHump",
  "Bevel_Half_ShallowRamp", "MP_SM_QuarterMediumBowl", "MP_Airvents",
];
const byName = new Map();
for (const [pkg, cp] of classOfPackage) {
  const n = pkg.split("/").pop();
  (byName.get(n) ?? byName.set(n, []).get(n)).push(cp);
}
const candidates = CANDIDATES.map((n) => {
  const cps = byName.get(n) ?? [];
  if (!cps.length) return { name: n, found: false };
  return { name: n, found: true, ...describe(cps.sort((a, b) => isItem(b) - isItem(a))[0]), ...(cps.length > 1 ? { otherMatches: cps.slice(1) } : {}) };
});

const out = {
  version: 1,
  notes: [
    "Level-editor items = Blueprint classes whose parent chain reaches BP_BaseItem (native root /Script/SKGGizmo.SKGMLEEditorItem). Hierarchy comes from package export maps, which need no property mappings.",
    "palette = what the in-game content browser shows: DT_MapItems rows -> PDA_MapItem data assets (Items[]: Name, Thumbnail, Class). Fully parsed (Blueprint-defined struct, no game usmap needed).",
    "DA_UGCPlaybackRecipeRegistry is a native BallestUGCPlaybackRecipeRegistry: its properties need the game's usmap ('Missing prop mappings for type BallestUGCPlaybackRecipeRegistry'), so only the classes it references (soft references in its name map) are listed, not per-class recipe data.",
    "referencedBy excludes the registry; cooked maps (Map_*) referencing an item means the class is placed in a shipped level.",
  ],
  palette: paletteCats,
  orphanPaletteDataAssets: orphanDAs,
  recipeRegistry: {
    path: REGISTRY,
    class: regEntry.exports?.[0]?.class ?? null,
    propertiesParsed: false,
    parseErrors: regEntry.parseErrors ?? [],
    imports: regEntry.imports ?? [],
    referencedPackages: [...(regEntry.namePaths ?? [])],
    referencedItemClasses: items.filter((cp) => regRefs.has(cp.split(".")[0])),
  },
  levelEditorItems: items.map(describe),
  candidates,
};
writeFileSync(join(assets, "registry.json"), JSON.stringify(out, null, 2) + "\n");
const inPal = out.levelEditorItems.filter((i) => i.inPalette).length;
console.error(`[registry] ${items.length} item classes, ${inPal} in palette (${paletteCats.length} categories), ${out.recipeRegistry.referencedItemClasses.length} in recipe registry, ${out.levelEditorItems.filter((i) => !i.inPalette && i.inRecipeRegistry).length} registry-only`);
