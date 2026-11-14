/** An approximation's placements as map items: each shape's catalog piece, scaled and turned to fill its box. */
import type { CatalogIndex, CatalogPiece } from "../Catalog"
import type { Tuple3, UeTransform, Vec3 } from "../coords"
import { itemFromPiece } from "../factory"
import { type Item, type MeshComponent, objectPathOf } from "../MapFile"
import { rotateVec, vecAdd, vecSub } from "../ueMath"
import { catalogFrame, type Placement, type ShapeKind, SHAPES } from "./shapes"

export const pieceOfShape = (catalog: CatalogIndex, kind: ShapeKind): CatalogPiece | undefined => {
  const className = SHAPES[kind].className
  for (const piece of catalog.pieceByClass.values()) if (piece.className === className) return piece
  return undefined
}

/**
 * The item transform that makes a piece with local `bounds` fill `fitted`'s box. An item's transform is its piece's
 * frame, and the bounds sit somewhere in that frame (the cube stands on its origin), so the translation is the box's
 * middle less where the bounds' middle lands once scaled and turned.
 */
export const transformOfPlacement = (
  { max, min }: { readonly min: Tuple3; readonly max: Tuple3 },
  fitted: Placement
): UeTransform => {
  const { center, half, rotation } = catalogFrame(fitted)
  const scale3D = {
    x: 2 * half.x / (max[0] - min[0]),
    y: 2 * half.y / (max[1] - min[1]),
    z: 2 * half.z / (max[2] - min[2])
  }
  const boundsMiddle = {
    x: (max[0] + min[0]) / 2 * scale3D.x,
    y: (max[1] + min[1]) / 2 * scale3D.y,
    z: (max[2] + min[2]) / 2 * scale3D.z
  }
  return { rotation, translation: vecSub(center, rotateVec(rotation, boundsMiddle)), scale3D }
}

/** `mesh` with every material slot holding `material`, a class-qualified material path. */
const painted = (mesh: MeshComponent, material: string): MeshComponent => ({
  ...mesh,
  materials: mesh.materials.map((slot) => ({ ...slot, material })),
  materialAssetPaths: mesh.materials.map(() => objectPathOf(material))
})

/**
 * The item for `placement`, moved by `offset` and painted `paint` when given. The primitives' Main component has no
 * relative transform of its own, so the item's transform is the actor's.
 */
const itemOfPlacement = (piece: CatalogPiece, placement: Placement, offset: Vec3, paint?: string): Item => {
  const { rotation, scale3D, translation } = transformOfPlacement(
    piece.bounds ?? SHAPES[placement.kind].bounds,
    placement
  )
  // Copies: an item's vectors are the map schema's own type, and placements may share one rotation.
  const item = itemFromPiece(piece, {
    rotation: { ...rotation },
    translation: { ...vecAdd(translation, offset) },
    scale3D: { ...scale3D }
  })
  if (paint === undefined) return item
  return { ...item, meshComponents: item.meshComponents.map((mesh) => painted(mesh, paint)) }
}

/** The items for `placements`, each moved by `offset`, and the shapes the catalog has no piece for. */
export const itemsOfPlacements = (
  catalog: CatalogIndex,
  placements: ReadonlyArray<Placement>,
  offset: Vec3,
  paint?: string
): { readonly items: ReadonlyArray<Item>; readonly missing: ReadonlyArray<ShapeKind> } => {
  const pieces = new Map<ShapeKind, CatalogPiece | undefined>()
  const pieceOf = (kind: ShapeKind) => {
    if (!pieces.has(kind)) pieces.set(kind, pieceOfShape(catalog, kind))
    return pieces.get(kind)
  }
  const missing = new Set<ShapeKind>()
  const items: Array<Item> = []
  for (const placement of placements) {
    const piece = pieceOf(placement.kind)
    if (piece === undefined) missing.add(placement.kind)
    else items.push(itemOfPlacement(piece, placement, offset, paint))
  }
  return { items, missing: [...missing] }
}
