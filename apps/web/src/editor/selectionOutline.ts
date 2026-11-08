/**
 * Selection outline along the mesh's own edges, like the game draws it. Two kinds of line:
 *
 * - creases, where faces meet at a sharp angle (a ramp's lip, a box's corners): always drawn;
 * - the silhouette of smooth surfaces (torus, sphere, a bevel's curve): each smooth edge
 *   carries the normals of its two faces, and the vertex shader drops it unless one face
 *   looks toward the camera and the other away. Computed per frame on the GPU, so it
 *   follows the camera with no CPU work and no frame of lag.
 *
 * The edge geometry is built once per mesh geometry (glb clones share theirs). The outline
 * group is parented to the item and each line carries its mesh's matrix relative to the
 * item, so it follows the item's world transform.
 */
import * as THREE from "three"
import { isMesh } from "./threeGuards"

/** Faces meeting at more than this angle form a crease; gentler edges only show on the silhouette. */
const CREASE_DEG = 30

/** Edges between faces this close to coplanar can never be on a silhouette (flat-face diagonals). */
const COPLANAR_DEG = 1

/** Vertices closer than this (cm) are the same corner; glbs split vertices at UV and normal seams. */
const WELD = 1e-4

/**
 * How far each line vertex is pulled toward the eye, as a fraction of its view distance.
 * The edges lie exactly on the mesh surface; without this they z-fight with it.
 */
const DEPTH_PULL = 0.002

/** The same in an orthographic pane, in cm: its camera stands far off, and depth there is even all the way along. */
const ORTHO_DEPTH_PULL = 4

const crease = Math.cos(THREE.MathUtils.degToRad(CREASE_DEG))
const coplanar = Math.cos(THREE.MathUtils.degToRad(COPLANAR_DEG))

interface Edge {
  readonly from: THREE.Vector3
  readonly to: THREE.Vector3
  /** Normals of the faces sharing the edge: one on an open border, three or more where non-manifold. */
  readonly faces: Array<THREE.Vector3>
}

const outlineCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()

/**
 * Line segments for every edge of `geometry` that can outline it, with attributes
 * `faceNormalA`/`faceNormalB` (the two faces' normals). Creases and open or non-manifold
 * edges get a zero `faceNormalB`, which the shader reads as "always draw". Built once and
 * freed with `geometry`.
 */
export const outlineOf = (geometry: THREE.BufferGeometry): THREE.BufferGeometry => {
  const cached = outlineCache.get(geometry)
  if (cached !== undefined) return cached
  const position = geometry.getAttribute("position")
  const index = geometry.getIndex()
  const count = index === null ? position.count : index.count
  const key = (v: THREE.Vector3) => `${Math.round(v.x / WELD)},${Math.round(v.y / WELD)},${Math.round(v.z / WELD)}`

  const corner = (j: number) => new THREE.Vector3().fromBufferAttribute(position, index === null ? j : index.getX(j))

  const edges = new Map<string, Edge>()
  const addEdge = (from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3) => {
    const [kf, kt] = [key(from), key(to)]
    if (kf === kt) return
    const id = kf < kt ? `${kf}|${kt}` : `${kt}|${kf}`
    const edge = edges.get(id)
    if (edge === undefined) edges.set(id, { from, to, faces: [normal] })
    else edge.faces.push(normal)
  }
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  for (let i = 0; i + 2 < count; i += 3) {
    const [a, b, c] = [corner(i), corner(i + 1), corner(i + 2)]
    const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a)).clone()
    if (normal.lengthSq() === 0) continue // degenerate triangle
    normal.normalize()
    addEdge(a, b, normal)
    addEdge(b, c, normal)
    addEdge(c, a, normal)
  }

  const positions: Array<number> = []
  const normalsA: Array<number> = []
  const normalsB: Array<number> = []
  const always = new THREE.Vector3()
  for (const { faces: [first, second, ...more], from, to } of edges.values()) {
    if (first === undefined) continue
    let b = always
    if (second !== undefined && more.length === 0) {
      const cos = first.dot(second)
      if (cos > coplanar) continue
      if (cos > crease) b = second
    }
    positions.push(...from.toArray(), ...to.toArray())
    normalsA.push(...first.toArray(), ...first.toArray())
    normalsB.push(...b.toArray(), ...b.toArray())
  }
  const outline = new THREE.BufferGeometry()
  outline.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  outline.setAttribute("faceNormalA", new THREE.Float32BufferAttribute(normalsA, 3))
  outline.setAttribute("faceNormalB", new THREE.Float32BufferAttribute(normalsB, 3))
  outlineCache.set(geometry, outline)
  geometry.addEventListener("dispose", () => {
    outlineCache.delete(geometry)
    outline.dispose()
  })
  return outline
}

/** Drops smooth edges that aren't on the silhouette and pulls every line toward the eye. */
const silhouetteShader = (shader: THREE.WebGLProgramParametersWithUniforms) => {
  shader.vertexShader = `attribute vec3 faceNormalA;
attribute vec3 faceNormalB;
${
    shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      bool perspective = isPerspectiveMatrix(projectionMatrix);
      vec3 toEye = perspective ? -mvPosition.xyz : vec3(0.0, 0.0, 1.0);
      // both ends lie on both faces' planes, so both see the same signs: the segment is kept or dropped whole
      bool silhouette = dot(normalMatrix * faceNormalA, toEye) * dot(normalMatrix * faceNormalB, toEye) <= 0.0;
      mvPosition.xyz += perspective ? toEye * ${DEPTH_PULL} : vec3(0.0, 0.0, ${ORTHO_DEPTH_PULL.toFixed(1)});
      gl_Position = silhouette ? projectionMatrix * mvPosition : vec4(0.0, 0.0, 2.0, 1.0); // dropped: beyond the far plane`
    )
  }`
}

/**
 * Shared by every outline line; two small materials for the editor's lifetime. The active
 * item (the one the gizmo and inspector follow) stands further from the scene: lighter on a
 * dark one, as in Blender, and darker on a pale one, where amber can't be read.
 */
export const OUTLINE_COLORS = {
  dark: { selected: "#ffb020", active: "#ffe08a" },
  light: { selected: "#c2500a", active: "#7a2e05" }
} as const
const silhouetteMaterial = (color: string): THREE.LineBasicMaterial => {
  const material = new THREE.LineBasicMaterial({ color, toneMapped: false })
  material.onBeforeCompile = silhouetteShader
  return material
}
const outlineMaterial = silhouetteMaterial(OUTLINE_COLORS.dark.selected)
const activeOutlineMaterial = silhouetteMaterial(OUTLINE_COLORS.dark.active)

/**
 * The paint tool's hover: what a click would paint, apart from the selection's amber, and red where the game takes no
 * paint (the status bar says why).
 */
export const PAINT_HOVER_COLORS = {
  dark: { paint: "#5ce1ff", blocked: "#ff5a5f" },
  light: { paint: "#0a6f94", blocked: "#c0182a" }
} as const
const paintHoverMaterial = silhouetteMaterial(PAINT_HOVER_COLORS.dark.paint)
const blockedHoverMaterial = silhouetteMaterial(PAINT_HOVER_COLORS.dark.blocked)

/** Recolours every outline for the theme. */
export const setOutlineTheme = (dark: boolean): void => {
  const colors = dark ? OUTLINE_COLORS.dark : OUTLINE_COLORS.light
  outlineMaterial.color.set(colors.selected)
  activeOutlineMaterial.color.set(colors.active)
  const hover = dark ? PAINT_HOVER_COLORS.dark : PAINT_HOVER_COLORS.light
  paintHoverMaterial.color.set(hover.paint)
  blockedHoverMaterial.color.set(hover.blocked)
}

const everyMesh = () => true

const inverse = new THREE.Matrix4()

/** The outline of one item: add it to the item, then `update` it from that item. Never raycast. */
export class SelectionOutline extends THREE.Group {
  private readonly lines: Array<THREE.LineSegments> = []

  /**
   * Matches the lines to the meshes under `item` (the outline itself holds no meshes) and
   * places each in `item`'s local space. Cheap enough per frame: glbs load async, so the
   * caller keeps it fresh. `active` picks the active item's colour.
   */
  update(item: THREE.Object3D, active = false): void {
    this.draw(item, active ? activeOutlineMaterial : outlineMaterial, everyMesh)
  }

  /** The paint tool's hover: the outline of the meshes under `item` that `shows` picks, blocked or not. */
  updatePaintHover(item: THREE.Object3D, shows: (mesh: THREE.Mesh) => boolean, blocked: boolean): void {
    this.draw(item, blocked ? blockedHoverMaterial : paintHoverMaterial, shows)
  }

  private draw(item: THREE.Object3D, material: THREE.LineBasicMaterial, shows: (mesh: THREE.Mesh) => boolean): void {
    item.updateMatrixWorld(true)
    inverse.copy(item.matrixWorld).invert()
    let count = 0
    item.traverse((object) => {
      if (!isMesh(object) || !shows(object)) return
      const lines = outlineOf(object.geometry)
      let line = this.lines[count]
      if (line === undefined) {
        line = new THREE.LineSegments(lines, outlineMaterial)
        line.matrixAutoUpdate = false
        line.raycast = () => {}
        this.lines.push(line)
      }
      line.geometry = lines
      line.material = material
      line.matrix.multiplyMatrices(inverse, object.matrixWorld)
      if (line.parent !== this) this.add(line)
      count++
    })
    for (const extra of this.lines.slice(count)) extra.removeFromParent()
    this.visible = count > 0
  }
}
