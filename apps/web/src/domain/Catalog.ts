/**
 * Schema for `assets/catalog.json`, produced by tools/extract (see tools/extract/README.md).
 * Decoding is tolerant: every object keeps unknown keys (index signature) and most fields
 * beyond the core shape are optional, so the app keeps working while the extractor evolves.
 *
 * Geometry conventions (from the catalog's own `coordinateSystem` note): bounds, relative
 * transforms and glb vertices are all in Unreal local space, centimetres, left-handed Z-up.
 * coords.ts converts them for rendering.
 */
import { Option, Schema } from "effect"
import { PropertyList } from "./MapFile"
import { inSizeOrder, type Ordinal, withOrdinals } from "./pieceName"
import { open } from "./schema"

const Vec3Tuple = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])
const QuatTuple = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite])
const NullableString = Schema.optionalKey(Schema.NullOr(Schema.String))

export class Bounds extends Schema.Opaque<Bounds>()(open({
  min: Vec3Tuple,
  max: Vec3Tuple
})) {}

const NullableBounds = Schema.optionalKey(Schema.NullOr(Bounds))

export class CatalogMaterialSlot extends Schema.Opaque<CatalogMaterialSlot>()(open({
  index: Schema.Int,
  /** Object path (`/Game/X.X`) or class-qualified path; see `qualifyMaterialPath`. */
  defaultMaterial: Schema.String,
  slotName: Schema.optionalKey(Schema.String),
  /** The mesh asset's own slot material (before blueprint overrides). */
  meshMaterial: Schema.optionalKey(Schema.NullOr(Schema.String))
})) {}

export class Rotator extends Schema.Opaque<Rotator>()(open({
  pitch: Schema.Finite,
  yaw: Schema.Finite,
  roll: Schema.Finite
})) {}

export class MainRelativeTransform extends Schema.Opaque<MainRelativeTransform>()(open({
  location: Vec3Tuple,
  rotation: Rotator,
  scale: Vec3Tuple
})) {}

export class ExtraMesh extends Schema.Opaque<ExtraMesh>()(open({
  name: Schema.String,
  meshAssetPath: Schema.NullOr(Schema.String),
  glb: NullableString,
  visible: Schema.optionalKey(Schema.Boolean),
  hiddenInGame: Schema.optionalKey(Schema.Boolean),
  transformRelativeToMain: open({ location: Vec3Tuple, quat: QuatTuple, scale: Vec3Tuple }),
  materialSlots: Schema.optionalKey(Schema.Array(CatalogMaterialSlot)),
  bounds: NullableBounds
})) {}

/**
 * A laser's beam, which the game builds in native code from the terminal's muzzle (Main-relative,
 * UE cm) in the direction `axis`: a thin core inside a wider glow, `length` cm long before the
 * item's scale.
 */
export class Beam extends Schema.Opaque<Beam>()(open({
  muzzle: Vec3Tuple,
  axis: Vec3Tuple,
  length: Schema.Finite,
  coreRadius: Schema.Finite,
  glowRadius: Schema.Finite,
  /** Linear RGB. */
  color: Vec3Tuple
})) {}

/** A choice of a dropdown row: the saved value and the game's label for it. */
export class CatalogPropertyOption extends Schema.Opaque<CatalogPropertyOption>()(open({
  value: Schema.Int,
  label: Schema.String
})) {}

/**
 * A property the level editor saves on a class, in the game's order. `list`/`type` are where and
 * how the game writes it; null when the extractor couldn't map the Blueprint type. `hidden`:
 * saved, but the game's details panel offers no control for it. The rest describe that control,
 * measured in game (tools/extract/panel.json): its label, kind and position, and for a number the
 * slider's range and step. `typedMax` is where a typed value stops when that's past the slider.
 */
export class CatalogProperty extends Schema.Opaque<CatalogProperty>()(open({
  name: Schema.String,
  list: Schema.NullOr(PropertyList),
  type: Schema.NullOr(Schema.String),
  default: Schema.Unknown,
  hidden: Schema.optionalKey(Schema.Boolean),
  label: Schema.optionalKey(Schema.String),
  control: Schema.optionalKey(Schema.Literals(["slider", "dropdown", "toggle", "color"])),
  row: Schema.optionalKey(Schema.Int),
  min: Schema.optionalKey(Schema.Finite),
  max: Schema.optionalKey(Schema.Finite),
  step: Schema.optionalKey(Schema.Finite),
  typedMax: Schema.optionalKey(Schema.Finite),
  options: Schema.optionalKey(Schema.Array(CatalogPropertyOption)),
  /**
   * A native property (surface, mirror) on a class no 0.4.1 save has shown yet: the game loads
   * the item without it, so new items leave it out until it's set (see docs/FORMAT.md).
   */
  optional: Schema.optionalKey(Schema.Boolean)
})) {}

/**
 * One end of a piece, in its local frame: a point, the direction it faces out of, its up, and the cross-section it
 * presents. Measured in the game (tools/extract/connectors.json, docs/SNAPPING.md § Connector data).
 */
export class Connector extends Schema.Opaque<Connector>()(open({
  position: Vec3Tuple,
  forward: Vec3Tuple,
  up: Vec3Tuple,
  /** The family of cross-sections it belongs to: "Track", "Bevel_F", "Tube F"... */
  profile: Schema.String,
  /** Which side a lopsided cross-section leans to, looking out of the end; absent for one that is the same both ways. */
  hand: Schema.optionalKey(Schema.Literals(["left", "right"]))
})) {}

export class CatalogPiece extends Schema.Opaque<CatalogPiece>()(open({
  classPath: Schema.String,
  className: Schema.String,
  /** null when the actor's Main component has no mesh (air vent, checkpoint strip, decal). */
  meshAssetPath: Schema.NullOr(Schema.String),
  glb: NullableString,
  materialSlots: Schema.Array(CatalogMaterialSlot),
  /** Whether the game's Paint panel lists the piece (`bCanChangeMaterial`); older catalogs leave it out. */
  paintable: Schema.optionalKey(Schema.Boolean),
  /** Slots the game's panel doesn't offer that a map file can still paint: the game draws and keeps them. */
  offPanelPaint: Schema.optionalKey(Schema.Array(Schema.Int)),
  bounds: NullableBounds,
  seenInSamples: Schema.optionalKey(Schema.Int),
  mainRelativeTransform: Schema.optionalKey(Schema.NullOr(MainRelativeTransform)),
  extraMeshes: Schema.optionalKey(Schema.Array(ExtraMesh)),
  beam: Schema.optionalKey(Beam),
  /** In-game browser category, display name, visibility and thumbnail (newer catalogs). */
  category: Schema.optionalKey(Schema.NullOr(Schema.String)),
  displayName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  inPalette: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  inRegistry: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  thumbnail: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** Exposed item properties with their defaults (newer catalogs). */
  properties: Schema.optionalKey(Schema.Array(CatalogProperty)),
  /** The piece's ends, once measured; a piece without any has none for Connectors to use. */
  connectors: Schema.optionalKey(Schema.Array(Connector))
})) {}

export class CatalogMesh extends Schema.Opaque<CatalogMesh>()(open({
  meshAssetPath: Schema.String,
  glb: NullableString,
  materialSlots: Schema.optionalKey(Schema.Array(CatalogMaterialSlot)),
  bounds: NullableBounds
})) {}

/** A mesh and the game's baked mirror of it (0.4.1 Mirror X / Mirror Y). */
export class MirrorPair extends Schema.Opaque<MirrorPair>()(open({
  meshAssetPath: Schema.String,
  mirrorMeshAssetPath: Schema.String
})) {}

/** A slot material the game swaps for another on a mirrored item (the spinning cylinder's cap). */
export class MirrorMaterial extends Schema.Opaque<MirrorMaterial>()(open({
  material: Schema.String,
  mirrored: Schema.String
})) {}

export class Catalog extends Schema.Opaque<Catalog>()(open({
  pieces: Schema.Array(CatalogPiece),
  meshes: Schema.optionalKey(Schema.Array(CatalogMesh)),
  unresolved: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  mirrors: Schema.optionalKey(open({
    meshes: Schema.Array(MirrorPair),
    materials: Schema.optionalKey(Schema.Array(MirrorMaterial))
  }))
})) {}

export const decodeCatalog = Schema.decodeUnknownEffect(Catalog)

/** Size (UE cm) drawn for things with no known bounds: the 1 m engine cube. */
export const DEFAULT_BOUNDS: Bounds = { min: [-50, -50, -50], max: [50, 50, 50] }

export interface MeshInfo {
  readonly meshAssetPath: string
  readonly glb: string | undefined
  readonly bounds: Bounds | undefined
  /** Default material per UE slot index (blueprint override, else the mesh's own). */
  readonly slotDefaults: ReadonlyArray<string | undefined>
}

/** Default game material per UE slot index: the component's override, else the mesh's own material. */
export const slotDefaultsOf = (slots: ReadonlyArray<CatalogMaterialSlot> | undefined): Array<string | undefined> => {
  const out: Array<string | undefined> = []
  for (const slot of slots ?? []) out[slot.index] = slot.defaultMaterial || slot.meshMaterial || undefined
  return out
}

/** Lookups used when rendering items. */
export interface CatalogIndex {
  readonly meshes: ReadonlyMap<string, MeshInfo>
  /** Each piece as the palette has it, so a name read from here is the one the Pieces panel shows. */
  readonly pieceByClass: ReadonlyMap<string, PalettePiece>
  /** The palette, worked out once per catalog. */
  readonly sections: ReadonlyArray<PaletteSection>
  /** Class path -> why the extractor couldn't resolve it (`catalog.unresolved`). */
  readonly unresolvedReasons: ReadonlyMap<string, string>
  /** Baked mirror mesh -> the mesh it mirrors. */
  readonly mirrorSources: ReadonlyMap<string, string>
  /** Mesh -> its baked mirror. */
  readonly mirrorMeshes: ReadonlyMap<string, string>
  readonly mirrorMaterials: ReadonlyArray<MirrorMaterial>
}

const orUndefined = <A>(a: A | null | undefined): A | undefined => a ?? undefined

const UnresolvedEntry = Schema.Struct({ classPath: Schema.String, reason: Schema.optionalKey(Schema.String) })
const decodeUnresolved = Schema.decodeUnknownOption(UnresolvedEntry)

export const indexCatalog = (catalog: Catalog): CatalogIndex => {
  const meshes = new Map<string, MeshInfo>()
  const add = (
    meshAssetPath: string | null,
    glb: string | null | undefined,
    bounds: Bounds | null | undefined,
    slots: ReadonlyArray<CatalogMaterialSlot> | undefined
  ) => {
    if (meshAssetPath === null || meshAssetPath.length === 0) return
    const prev = meshes.get(meshAssetPath)
    const defaults = slotDefaultsOf(slots)
    meshes.set(meshAssetPath, {
      meshAssetPath,
      glb: prev?.glb ?? orUndefined(glb),
      bounds: prev?.bounds ?? orUndefined(bounds),
      slotDefaults: prev !== undefined && prev.slotDefaults.length > 0 ? prev.slotDefaults : defaults
    })
  }
  // Piece slots carry the blueprint's overrides, so they win over the bare mesh table.
  for (const piece of catalog.pieces) {
    add(piece.meshAssetPath, piece.glb, piece.bounds, piece.materialSlots)
    for (const extra of piece.extraMeshes ?? []) add(extra.meshAssetPath, extra.glb, extra.bounds, extra.materialSlots)
  }
  for (const mesh of catalog.meshes ?? []) add(mesh.meshAssetPath, mesh.glb, mesh.bounds, mesh.materialSlots)
  const sections = paletteSections(catalog.pieces)
  const pieceByClass = new Map<string, PalettePiece>()
  for (const { pieces } of sections) {
    for (const piece of pieces) if (!pieceByClass.has(piece.classPath)) pieceByClass.set(piece.classPath, piece)
  }
  const unresolvedReasons = new Map<string, string>()
  for (const entry of catalog.unresolved ?? []) {
    const decoded = decodeUnresolved(entry)
    if (Option.isSome(decoded) && !unresolvedReasons.has(decoded.value.classPath)) {
      unresolvedReasons.set(
        decoded.value.classPath,
        decoded.value.reason ?? "The extractor couldn't resolve this piece."
      )
    }
  }
  const mirrorSources = new Map<string, string>()
  const mirrorMeshes = new Map<string, string>()
  for (const pair of catalog.mirrors?.meshes ?? []) {
    if (!mirrorSources.has(pair.mirrorMeshAssetPath)) mirrorSources.set(pair.mirrorMeshAssetPath, pair.meshAssetPath)
    if (!mirrorMeshes.has(pair.meshAssetPath)) mirrorMeshes.set(pair.meshAssetPath, pair.mirrorMeshAssetPath)
  }
  return {
    meshes,
    pieceByClass,
    sections,
    unresolvedReasons,
    mirrorSources,
    mirrorMeshes,
    mirrorMaterials: catalog.mirrors?.materials ?? []
  }
}

/**
 * Extra meshes drawn in game (visible and not hiddenInGame). They're the only visuals for
 * pieces whose Main has no mesh (air vent, checkpoint strip).
 */
export const visibleExtras = (piece: CatalogPiece | undefined): ReadonlyArray<ExtraMesh> =>
  (piece?.extraMeshes ?? []).filter((extra) =>
    extra.visible !== false && extra.hiddenInGame !== true && extra.meshAssetPath !== null
  )

export const pieceIdOf = (piece: CatalogPiece): string => `${piece.classPath}|${piece.meshAssetPath ?? ""}`

/** The pieces the in-game browser doesn't show. */
export const HIDDEN_SECTION = "Hidden"
export const OTHER_SECTION = "Other"

/** A piece as a palette section lists it: numbered if it would read the same as another there. */
export type PalettePiece = CatalogPiece & Ordinal

export interface PaletteSection {
  readonly name: string
  readonly pieces: ReadonlyArray<PalettePiece>
  readonly hidden: boolean
}

/**
 * Palette sections: in-game categories in file order, then "Other" (no category), then the
 * pieces the in-game browser doesn't show (`inPalette: false`). Piece order is file order, but for `inSizeOrder`.
 * Pieces in a section that read the same are numbered (`withOrdinals`).
 */
export const paletteSections = (pieces: ReadonlyArray<CatalogPiece>): ReadonlyArray<PaletteSection> => {
  const byCategory = new Map<string, Array<CatalogPiece>>()
  const other: Array<CatalogPiece> = []
  const hidden: Array<CatalogPiece> = []
  for (const piece of pieces) {
    if (piece.inPalette === false) hidden.push(piece)
    else if (piece.category === undefined || piece.category === null || piece.category === "") other.push(piece)
    else {
      const list = byCategory.get(piece.category) ?? []
      list.push(piece)
      byCategory.set(piece.category, list)
    }
  }
  const listed = (list: ReadonlyArray<CatalogPiece>): ReadonlyArray<PalettePiece> => withOrdinals(inSizeOrder(list))
  return [
    ...[...byCategory].map(([name, list]) => ({ name, pieces: listed(list), hidden: false })),
    ...(other.length > 0 ? [{ name: OTHER_SECTION, pieces: listed(other), hidden: false }] : []),
    ...(hidden.length > 0 ? [{ name: HIDDEN_SECTION, pieces: listed(hidden), hidden: true }] : [])
  ]
}

const NO_MESH = "This piece has no mesh to show."
const REJECTED = "The game can't load this piece; maps that use it open blank."

/** The user's words for why the extractor couldn't resolve a class; its own reasons are notes for whoever runs it. */
const unresolvedCopyOf = (reason: string): string => {
  if (reason.startsWith("removed from the game")) {
    return "This piece was removed from the game, so maps using it won't load."
  }
  return reason.startsWith("no StaticMeshComponent") ? NO_MESH : "Can't be placed from the editor."
}

/**
 * Why a piece can't be placed, as the user reads it, or undefined if it can: the extractor lists it as unresolved (base
 * classes, runtime-generated geometry, a class the game dropped), the in-game editor rejects it, or it has no mesh of
 * any kind. Unresolved comes first, because it says more: a class the game dropped is rejected too.
 */
export const unavailableReasonOf = (
  index: CatalogIndex,
  piece: CatalogPiece,
  verified: VerificationTable = NO_VERIFICATION
): string | undefined => {
  const unresolved = index.unresolvedReasons.get(piece.classPath)
  if (unresolved !== undefined) return unresolvedCopyOf(unresolved)
  if (verificationOf(piece, verified) === "rejected") return REJECTED
  return piece.meshAssetPath === null && (piece.extraMeshes ?? []).length === 0 ? NO_MESH : undefined
}

// ---------------------------------------------------------------------------
// In-game verification (assets/verified.json): which hidden classes the in-game editor
// actually loads. One rejected item makes the game discard the whole map.

export const VerificationStatus = Schema.Literals(["ok", "rejected"])
export const VerificationEntry = open({
  status: VerificationStatus,
  date: Schema.optionalKey(Schema.String),
  /** What the probe found, for whoever reads the file. The user reads `unavailableReasonOf`. */
  note: Schema.optionalKey(Schema.String)
})
export const VerificationFile = open({ results: Schema.Record(Schema.String, VerificationEntry) })
export type VerificationTable = typeof VerificationFile.Type["results"]
export const decodeVerification = Schema.decodeUnknownEffect(VerificationFile)
export const NO_VERIFICATION: VerificationTable = {}

export type Verification = "ok" | "rejected" | "unverified"

/** Palette pieces are what the game itself offers; hidden ones are only as good as our probes. */
export const verificationOf = (piece: CatalogPiece, table: VerificationTable): Verification => {
  const entry = table[piece.className]
  if (entry !== undefined) return entry.status
  return piece.inPalette === false ? "unverified" : "ok"
}

/** Classes in a map that the in-game editor rejects / hasn't been shown to accept. */
export const riskyClassesIn = (
  classNames: ReadonlyArray<string>,
  pieces: ReadonlyArray<CatalogPiece>,
  table: VerificationTable
): { readonly rejected: ReadonlyArray<string>; readonly unverified: ReadonlyArray<string> } => {
  const byName = new Map(pieces.map((p) => [p.className, p]))
  const rejected = new Set<string>()
  const unverified = new Set<string>()
  for (const name of classNames) {
    const piece = byName.get(name)
    const status = piece === undefined ? "unverified" : verificationOf(piece, table)
    if (status === "rejected") rejected.add(name)
    else if (status === "unverified") unverified.add(name)
  }
  return { rejected: [...rejected], unverified: [...unverified] }
}
