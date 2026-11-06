/** What the snapping tests share: a Track-like catalog, a map of its pieces, and a pane to measure them in. */
import { Schema } from "effect"
import fixture from "../domain/bundledCatalog.json"
import { Catalog, indexCatalog } from "../domain/Catalog"
import type { Vec3 } from "../domain/coords"
import { identityTransform, itemFromPiece, newMapFile } from "../domain/factory"
import type { Box } from "../domain/itemBounds"
import type { Item } from "../domain/MapFile"
import type { WorldMesh } from "../domain/meshElements"
import { defaultSettings } from "../domain/Settings"
import type { SnapItem, SnapView } from "../domain/snapFrame"
import { useEditor } from "../editor/store"

/** A slab's two ends along X, as Track S's. */
export const TRACK_ENDS = [
  { position: [250, 0, 50], forward: [1, 0, 0], up: [0, 0, 1], profile: "Track" },
  { position: [-250, 0, 50], forward: [-1, 0, 0], up: [0, 0, 1], profile: "Track" }
]

/** The bundled catalog with `connectors` on its first piece. */
export const catalogWithEnds = (connectors: ReadonlyArray<unknown> = TRACK_ENDS) =>
  Schema.decodeUnknownSync(Catalog)({
    ...fixture,
    pieces: fixture.pieces.map((piece, i) => i === 0 ? { ...piece, connectors } : piece)
  })

/** `at` as a loaded map of the catalog's piece `index`, answering their keys. The first has ends, and is the player start. */
export const loadPieces = (at: ReadonlyArray<Vec3>, index = 0): ReadonlyArray<string> => {
  const catalog = catalogWithEnds()
  const piece = catalog.pieces[index]
  if (piece === undefined) throw new Error("the bundled catalog has no such piece")
  const map = {
    ...newMapFile({ displayName: "Test", creatorName: "me", createdAt: "" }),
    items: at.map((point) => itemFromPiece(piece, identityTransform(point)))
  }
  useEditor.setState({ catalogIndex: indexCatalog(catalog), settings: defaultSettings })
  useEditor.getState().loadMap(map, null)
  return useEditor.getState().doc.ids
}

/** Groups `keys`, or makes them a chain, answering the group's id. */
export const grouped = (keys: ReadonlyArray<string>, chain = false): string => {
  const s = useEditor.getState()
  s.select(keys)
  if (chain) s.chainSelection()
  else s.groupSelection()
  const group = useEditor.getState().doc.structure.tree.find((node) => node.kind === "group")
  if (group?.kind !== "group") throw new Error("the selection wasn't grouped")
  return group.id
}

/** `item` with these bool properties on, and no meshes, which the game flips by its class alone. */
export const withFlags = (item: Item, ...names: ReadonlyArray<string>): Item => ({
  ...item,
  meshComponents: [],
  boolProperties: names.map((propertyName) => ({ propertyName, propertyType: "Bool", currentValue: true }))
})

/** Looking straight down, `cmPerPixel` cm to the pixel: the pixel is the point's x and y. */
export const topView = (cmPerPixel = 1, over: Partial<SnapView> = {}): SnapView => ({
  project: ({ x, y }) => ({ x: x / cmPerPixel, y: y / cmPerPixel }),
  rayAt: ({ x, y }) => ({
    origin: { x: x * cmPerPixel, y: y * cmPerPixel, z: 10000 },
    direction: { x: 0, y: 0, z: -1 }
  }),
  cmPerPixelAt: () => cmPerPixel,
  directionAt: () => ({ x: 0, y: 0, z: -1 }),
  orthographic: true,
  inView: () => true,
  ...over
})

export const boxAt = ({ x, y, z }: Vec3, half = 50): Box => ({
  min: { x: x - half, y: y - half, z: z - half },
  max: { x: x + half, y: y + half, z: z + half }
})

/** The mesh of a plain box: eight corners, twelve edges, six faces. */
export const meshOfBox = ({ max, min }: Box): WorldMesh => {
  const mid = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }
  const axes = ["x", "y", "z"] as const
  const at = (a: Vec3, axis: "x" | "y" | "z", value: number): Vec3 => ({ ...a, [axis]: value })
  const corners = [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => ({ x, y, z }))))
  const faces = axes.flatMap((axis, i) =>
    ([[min, -1], [max, 1]] as const).map(([side, sign]) => {
      const centre = at(mid, axis, side[axis])
      const [u = "x", v = "y"] = [axes[(i + 1) % 3], axes[(i + 2) % 3]]
      const corner = (a: Vec3, b: Vec3) => at(at(centre, u, a[u]), v, b[v])
      return {
        centre,
        normal: at({ x: 0, y: 0, z: 0 }, axis, sign),
        corners: [corner(min, min), corner(max, min), corner(max, max), corner(min, max)]
      }
    })
  )
  const edges = corners.flatMap((from, i) =>
    corners.slice(i + 1).flatMap((to) =>
      axes.filter((axis) => from[axis] !== to[axis]).length === 1 ? [[from, to] as const] : []
    )
  )
  return { vertices: corners, edges, faceCentres: faces.map(({ centre }) => centre), faces }
}

/** A 100 cm cube at `at`, as a target. */
export const cubeAt = (key: string, at: Vec3, over: Partial<SnapItem> = {}): SnapItem => ({
  key,
  name: "Cube",
  box: boxAt(at),
  transform: identityTransform(at),
  bounds: { min: [-50, -50, -50], max: [50, 50, 50] },
  ends: [],
  mesh: () => undefined,
  ...over
})

/** An end of `item` facing along X, for what only needs its place and direction. */
export const endAlongX = (item: string, index: number, x: number, facing: 1 | -1) => ({
  ref: { item, end: index },
  position: { x, y: 0, z: 0 },
  forward: { x: facing, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 },
  profile: "Track"
})
