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

export class CatalogPiece extends Schema.Opaque<CatalogPiece>()(open({
  classPath: Schema.String,
  className: Schema.String,
  /** null when the actor's Main component has no mesh (air vent, checkpoint strip, decal). */
  meshAssetPath: Schema.NullOr(Schema.String),
  glb: NullableString,
  materialSlots: Schema.Array(CatalogMaterialSlot),
  bounds: NullableBounds,
  seenInSamples: Schema.optionalKey(Schema.Int),
  mainRelativeTransform: Schema.optionalKey(Schema.NullOr(MainRelativeTransform)),
  extraMeshes: Schema.optionalKey(Schema.Array(ExtraMesh)),
  /** In-game browser category, display name, visibility and thumbnail (newer catalogs). */
  category: Schema.optionalKey(Schema.NullOr(Schema.String)),
  displayName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  inPalette: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  inRegistry: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  thumbnail: Schema.optionalKey(Schema.NullOr(Schema.String))
})) {}

export class CatalogMesh extends Schema.Opaque<CatalogMesh>()(open({
  meshAssetPath: Schema.String,
  glb: NullableString,
  materialSlots: Schema.optionalKey(Schema.Array(CatalogMaterialSlot)),
  bounds: NullableBounds
})) {}

export class Catalog extends Schema.Opaque<Catalog>()(open({
  pieces: Schema.Array(CatalogPiece),
  meshes: Schema.optionalKey(Schema.Array(CatalogMesh)),
  unresolved: Schema.optionalKey(Schema.Array(Schema.Unknown))
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

const slotDefaultsOf = (slots: ReadonlyArray<CatalogMaterialSlot> | undefined): Array<string | undefined> => {
  const out: Array<string | undefined> = []
  for (const slot of slots ?? []) out[slot.index] = slot.defaultMaterial || slot.meshMaterial || undefined
  return out
}

/** Lookups used when rendering items. */
export interface CatalogIndex {
  readonly meshes: ReadonlyMap<string, MeshInfo>
  readonly pieceByClass: ReadonlyMap<string, CatalogPiece>
  /** Class path -> why the extractor couldn't resolve it (`catalog.unresolved`). */
  readonly unresolvedReasons: ReadonlyMap<string, string>
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
  const pieceByClass = new Map<string, CatalogPiece>()
  for (const piece of catalog.pieces) if (!pieceByClass.has(piece.classPath)) pieceByClass.set(piece.classPath, piece)
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
  return { meshes, pieceByClass, unresolvedReasons }
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

export const HIDDEN_SECTION = "Hidden (not in the in-game browser)"
export const OTHER_SECTION = "Other"

export interface PaletteSection {
  readonly name: string
  readonly pieces: ReadonlyArray<CatalogPiece>
  readonly hidden: boolean
}

/**
 * Palette sections: in-game categories in file order, then "Other" (no category), then the
 * pieces the in-game browser doesn't show (`inPalette: false`). Piece order is file order.
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
  return [
    ...[...byCategory].map(([name, list]) => ({ name, pieces: list, hidden: false })),
    ...(other.length > 0 ? [{ name: OTHER_SECTION, pieces: other, hidden: false }] : []),
    ...(hidden.length > 0 ? [{ name: HIDDEN_SECTION, pieces: hidden, hidden: true }] : [])
  ]
}

export const pieceLabelOf = (piece: CatalogPiece): string => piece.displayName || piece.className

/**
 * Why a piece can't be placed, or undefined if it can: the extractor lists it as
 * unresolved (base classes, runtime-generated geometry), or it has no mesh of any kind.
 */
export const unavailableReasonOf = (
  index: CatalogIndex,
  piece: CatalogPiece,
  verified: VerificationTable = NO_VERIFICATION
): string | undefined => {
  if (verificationOf(piece, verified) === "rejected") {
    return `The in-game editor rejects this piece${
      verified[piece.className]?.note ? ` (${verified[piece.className]?.note})` : ""
    }.`
  }
  const unresolved = index.unresolvedReasons.get(piece.classPath)
  if (unresolved !== undefined) return unresolved
  if (piece.meshAssetPath === null && (piece.extraMeshes ?? []).length === 0) {
    return "No mesh: this class has no geometry the editor can place."
  }
  return undefined
}

// ---------------------------------------------------------------------------
// In-game verification (assets/verified.json): which hidden classes the in-game editor
// actually loads. One rejected item makes the game discard the whole map.

export const VerificationStatus = Schema.Literals(["ok", "rejected"])
export const VerificationEntry = open({
  status: VerificationStatus,
  date: Schema.optionalKey(Schema.String),
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
