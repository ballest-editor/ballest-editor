/**
 * The map as targets for one drag: every item but what moves, with its box, ends and mesh, and the raycasts the domain
 * asks for. Built when a drag starts, as nothing else moves until it ends, and a mesh's elements are only worked out for
 * the items a pointer comes near.
 */
import * as THREE from "three"
import { endsOf } from "../../domain/connectors"
import type { Vec3 } from "../../domain/coords"
import { editTransform } from "../../domain/editTransform"
import { placedBoxOf } from "../../domain/itemBounds"
import { type MeshElements, meshElementsOf, placedMesh, type WorldMesh } from "../../domain/meshElements"
import { pivotBoundsOf } from "../../domain/pivot"
import type { SnapItem, SnapView, SurfaceHit } from "../../domain/snapFrame"
import type { PaneCamera } from "../paneCameras"
import { sceneRegistry } from "../sceneRegistry"
import { type EditorState, nodeNamesOf } from "../store"
import { isMesh } from "../threeGuards"
import { toGame, toThree } from "./snapView"

/** A point at most this far behind what is hit still shows: it's on that surface. */
const HIDDEN_PAST_CM = 1

const elementsByGeometry = new WeakMap<THREE.BufferGeometry, Map<number, MeshElements>>()

/** A geometry's corners in its own frame, read through the attribute so a quantised one comes out in cm. */
const positionsOf = (geometry: THREE.BufferGeometry): Float32Array | undefined => {
  if (!geometry.hasAttribute("position")) return undefined
  const attribute = geometry.getAttribute("position")
  const out = new Float32Array(attribute.count * 3)
  for (let i = 0; i < attribute.count; i++) {
    out[i * 3] = attribute.getX(i)
    out[i * 3 + 1] = attribute.getY(i)
    out[i * 3 + 2] = attribute.getZ(i)
  }
  return out
}

const elementsOf = (geometry: THREE.BufferGeometry, sharpAngle: number): MeshElements | undefined => {
  const cached = elementsByGeometry.get(geometry)?.get(sharpAngle)
  if (cached !== undefined) return cached
  const positions = positionsOf(geometry)
  if (positions === undefined) return undefined
  const elements = meshElementsOf(positions, geometry.getIndex()?.array ?? null, sharpAngle)
  const byAngle = elementsByGeometry.get(geometry) ?? new Map<number, MeshElements>()
  elementsByGeometry.set(geometry, byAngle.set(sharpAngle, elements))
  return elements
}

/** Every visible mesh under an item's object. */
const meshesOf = (key: string): ReadonlyArray<THREE.Mesh> => {
  const out: Array<THREE.Mesh> = []
  sceneRegistry.objects.get(key)?.traverseVisible((object) => {
    if (isMesh(object)) out.push(object)
  })
  return out
}

/** An item's mesh elements where it stands, from what the renderer has; undefined until its mesh has loaded. */
const worldMeshOf = (key: string, sharpAngle: number): WorldMesh | undefined => {
  const parts = meshesOf(key).flatMap((mesh) => {
    const elements = elementsOf(mesh.geometry, sharpAngle)
    if (elements === undefined) return []
    const point = new THREE.Vector3()
    return [placedMesh(elements, ({ x, y, z }) => toGame(point.set(x, y, z).applyMatrix4(mesh.matrixWorld)))]
  })
  if (parts.length === 0) return undefined
  return {
    vertices: parts.flatMap(({ vertices }) => vertices),
    edges: parts.flatMap(({ edges }) => edges),
    faceCentres: parts.flatMap(({ faceCentres }) => faceCentres),
    faces: parts.flatMap(({ faces }) => faces),
    runs: parts.flatMap(({ runs }) => runs)
  }
}

/** What's in the map but for `except`, as targets. */
export const snapItemsOf = (
  s: Pick<EditorState, "doc" | "catalogIndex">,
  except: ReadonlySet<string>,
  sharpAngle: number
): ReadonlyArray<SnapItem> => {
  const names = nodeNamesOf(s)
  return s.doc.map.items.flatMap((item, index): ReadonlyArray<SnapItem> => {
    const key = s.doc.ids[index]
    if (key === undefined || except.has(key)) return []
    const transform = editTransform(item)
    const box = placedBoxOf([{ item, transform }], s.catalogIndex)
    if (box === undefined) return []
    let mesh: WorldMesh | undefined
    return [{
      key,
      name: names.get(key)?.name ?? "a piece",
      box,
      transform,
      bounds: pivotBoundsOf(item, s.catalogIndex),
      ends: endsOf(key, item, transform, s.catalogIndex),
      mesh: () => {
        mesh ??= worldMeshOf(key, sharpAngle)
        return mesh
      }
    }]
  })
}

const threeBox = ({ box: { max, min } }: SnapItem) => new THREE.Box3().setFromPoints([toThree(min), toThree(max)])

/** The item a mesh is part of. */
const itemOf = (object: THREE.Object3D | null): string | undefined => {
  for (let at = object; at !== null; at = at.parent) {
    const id: unknown = at.userData["itemId"]
    if (typeof id === "string") return id
  }
  return undefined
}

const normalOf = (hit: THREE.Intersection, towards: THREE.Vector3): THREE.Vector3 | undefined => {
  if (hit.face === undefined || hit.face === null) return undefined
  const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
  normal.normalize()
  return normal.dot(towards) < 0 ? normal.negate() : normal
}

const cornersOf = (hit: THREE.Intersection): ReadonlyArray<Vec3> => {
  if (hit.face === undefined || hit.face === null || !isMesh(hit.object)) return []
  const position = hit.object.geometry.getAttribute("position")
  const { matrixWorld } = hit.object
  return [hit.face.a, hit.face.b, hit.face.c].map((i) =>
    toGame(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrixWorld))
  )
}

/** The raycasts of `items` in one pane: only what the ray's box test lets through is walked, however big the map. */
export const snapCasts = (items: ReadonlyArray<SnapItem>, pane: PaneCamera, view: SnapView) => {
  const boxes = items.map((item) => ({ item, box: threeBox(item) }))
  const raycaster = new THREE.Raycaster()
  const under = (ray: THREE.Ray) => {
    raycaster.ray.copy(ray)
    const objects = boxes.flatMap(({ box, item }) => ray.intersectsBox(box) ? meshesOf(item.key) : [])
    return raycaster.intersectObjects([...objects], false)
  }
  const castAt = (px: { readonly x: number; readonly y: number }) => {
    const { direction, origin } = view.rayAt(px)
    return new THREE.Ray(toThree(origin), toThree(direction))
  }
  return {
    surfaceAt: (px: { readonly x: number; readonly y: number }): SurfaceHit | undefined => {
      const ray = castAt(px)
      const [hit] = under(ray)
      const item = hit === undefined ? undefined : itemOf(hit.object)
      if (hit === undefined || item === undefined) return undefined
      const normal = normalOf(hit, ray.direction.clone().negate())
      return normal === undefined
        ? undefined
        : { point: toGame(hit.point), normal: toGame(normal), item, corners: cornersOf(hit) }
    },
    occluded: (point: Vec3): boolean => {
      const target = toThree(point)
      const from = pane.view === undefined
        ? pane.camera.position.clone()
        : target.clone().sub(pane.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(1e6))
      const direction = target.clone().sub(from)
      const distance = direction.length()
      const [hit] = under(new THREE.Ray(from, direction.normalize()))
      return hit !== undefined && hit.distance < distance - HIDDEN_PAST_CM
    }
  }
}
