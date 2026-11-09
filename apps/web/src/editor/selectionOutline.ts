/**
 * Selection outline along the mesh's own edges, like the game draws it. Two kinds of line:
 *
 * - creases, where faces meet at a sharp angle (a ramp's lip, a box's corners): always drawn;
 * - the silhouette of smooth surfaces (torus, sphere, a bevel's curve): each smooth edge
 *   carries the normals of its two faces, and the vertex shader drops it unless one face
 *   looks toward the camera and the other away. Computed per frame on the GPU, so it
 *   follows the camera with no CPU work and no frame of lag.
 *
 * The lines are the scene's fat lines (screenLines.ts): a width in pixels, round where two edges meet. A selected
 * item's outline also shows through whatever stands in front of it, in the scene's dash: a second pass of the same edges
 * that only draws where the scene is nearer than the line. It keeps to the side of the item that faces the camera (its
 * silhouette and the creases of faces turned toward the eye), so the item's own back doesn't fill it with hidden edges.
 * A crease dashes along itself, so its corners meet on dashes; a silhouette is many short edges, and its dashes run on
 * from one to the next.
 *
 * The edge geometry is built once per mesh geometry (glb clones share theirs). The outline
 * group is parented to the item and each line carries its mesh's matrix relative to the
 * item, so it follows the item's world transform.
 *
 * The paint tool's hover also shades the faces it outlines: each mesh's own geometry drawn again, translucent, with the
 * same matrix, so a mirrored mesh (a negative scale on its way to the item) culls and shades the same faces it draws.
 */
import * as THREE from "three"
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"
import { SCENE_ROLES } from "./sceneColors"
import { hiddenLineMaterial, LINE_WIDTH, lineMaterial, type LineShaderEdit, screenDashes } from "./screenLines"
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

const outlineCache = new WeakMap<THREE.BufferGeometry, LineSegmentsGeometry>()

/**
 * A fat line segment for every edge of `geometry` that can outline it (`instanceStart`/`instanceEnd`), each with
 * `faceNormalA`/`faceNormalB` (the two faces' normals; the one face's twice on an open edge) and `edgeAlways` (1 for a
 * crease, an open or a non-manifold edge, which is always drawn; 0 for a smooth edge, drawn on the silhouette alone).
 * Built once and freed with `geometry`.
 */
export const outlineOf = (geometry: THREE.BufferGeometry): LineSegmentsGeometry => {
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

  const ends: Array<number> = []
  const normalsA: Array<number> = []
  const normalsB: Array<number> = []
  const always: Array<number> = []
  for (const { faces: [first, second, ...more], from, to } of edges.values()) {
    if (first === undefined) continue
    let smooth = false
    if (second !== undefined && more.length === 0) {
      const cos = first.dot(second)
      if (cos > coplanar) continue
      smooth = cos > crease
    }
    ends.push(...from.toArray(), ...to.toArray())
    normalsA.push(...first.toArray())
    normalsB.push(...(second ?? first).toArray())
    always.push(smooth ? 0 : 1)
  }
  const outline = new LineSegmentsGeometry()
  if (ends.length > 0) outline.setPositions(ends)
  outline.setAttribute("faceNormalA", new THREE.InstancedBufferAttribute(new Float32Array(normalsA), 3))
  outline.setAttribute("faceNormalB", new THREE.InstancedBufferAttribute(new Float32Array(normalsB), 3))
  outline.setAttribute("edgeAlways", new THREE.InstancedBufferAttribute(new Float32Array(always), 1))
  outline.instanceCount = always.length
  outlineCache.set(geometry, outline)
  geometry.addEventListener("dispose", () => {
    outlineCache.delete(geometry)
    outline.dispose()
  })
  return outline
}

const pullToward = (eye: string) =>
  `${eye}.xyz += outlineView ? - ${eye}.xyz * ${DEPTH_PULL} : vec3( 0.0, 0.0, ${ORTHO_DEPTH_PULL.toFixed(1)} );`

/**
 * Which of a fat line's edges show, and the pull toward the eye. `shown` is GLSL over `edgeAlways`, `silhouette` and
 * the two faces' `facingA`/`facingB` (positive where a face looks toward the eye; both ends see the same signs, so a
 * segment is kept or dropped whole). A dropped one goes beyond the far plane.
 *
 * The edges lie exactly on the mesh, so each end is pulled toward the eye along its own view ray, where it stays on
 * screen: without it they z-fight with the faces. Done in the shader because the renderer's logarithmic depth buffer
 * writes `gl_FragDepth`, which `polygonOffset` doesn't move.
 */
const outlineEdges = (shown: string): LineShaderEdit => ({
  vertexHeader: `attribute vec3 faceNormalA;
attribute vec3 faceNormalB;
attribute float edgeAlways;`,
  afterEnds: `bool outlineView = isPerspectiveMatrix( projectionMatrix );
      vec3 toEye = outlineView ? - start.xyz : vec3( 0.0, 0.0, 1.0 );
      float facingA = dot( normalMatrix * faceNormalA, toEye );
      float facingB = dot( normalMatrix * faceNormalB, toEye );
      bool silhouette = facingA * facingB <= 0.0;
      bool shown = ${shown};
      ${pullToward("start")}
      ${pullToward("end")}`,
  place: "gl_Position = shown ? clip : vec4( 0.0, 0.0, 2.0, 1.0 );"
})

/** Creases, and the silhouette of smooth edges. */
const SHOWN_EDGES = [outlineEdges("edgeAlways > 0.5 || silhouette")]

/** The side toward the eye: the silhouette, and the creases of a face turned to it. Smooth edges' dashes run on. */
const HIDDEN_EDGES = [
  outlineEdges("silhouette || ( edgeAlways > 0.5 && max( facingA, facingB ) > 0.0 )"),
  screenDashes("( edgeAlways > 0.5 ? 0.0 : 1.0 )")
]

/** Pulls a fill toward the eye like the lines, so it lies over the faces it shades and not under them. */
const fillShader = (shader: THREE.WebGLProgramParametersWithUniforms) => {
  shader.vertexShader = shader.vertexShader.replace(
    "#include <project_vertex>",
    `#include <project_vertex>
      bool outlineView = isPerspectiveMatrix( projectionMatrix );
      ${pullToward("mvPosition")}
      gl_Position = projectionMatrix * mvPosition;`
  )
}

/**
 * The selection's colours (`SCENE_ROLES` in sceneColors.ts). The active item (the one the gizmo and inspector follow)
 * stands further from the scene: lighter on a dark one, as in Blender, and darker on a pale one, where amber can't be
 * read. The hidden part is the same colour, dashed and lighter.
 */
export const OUTLINE_COLORS = {
  dark: { selected: SCENE_ROLES.dark.selected, active: SCENE_ROLES.dark.active },
  light: { selected: SCENE_ROLES.light.selected, active: SCENE_ROLES.light.active }
} as const

/**
 * The pointer's colours: what a click would act on. The hover's outline in the select tools, and the paint tool's
 * outline and the faces under it, shaded at `fill` opacity: more in the light theme, where the cyan has to darken pale
 * metal to read. Red where the game takes no paint (the status bar says why).
 */
export const PAINT_HOVER_COLORS = {
  dark: { paint: SCENE_ROLES.dark.pointer, blocked: SCENE_ROLES.dark.blocked, fill: 0.3 },
  light: { paint: SCENE_ROLES.light.pointer, blocked: SCENE_ROLES.light.blocked, fill: 0.45 }
} as const

/** Shared by every outline: a few small materials for the editor's lifetime. */
const edgeMaterial = (color: string, linewidth: number): LineMaterial =>
  lineMaterial({ color, linewidth }, SHOWN_EDGES, "selection-outline")
const outlineMaterial = edgeMaterial(OUTLINE_COLORS.dark.selected, LINE_WIDTH.outline)
const activeOutlineMaterial = edgeMaterial(OUTLINE_COLORS.dark.active, LINE_WIDTH.outline)
const hoverMaterial = edgeMaterial(PAINT_HOVER_COLORS.dark.paint, LINE_WIDTH.light)
const paintMaterial = edgeMaterial(PAINT_HOVER_COLORS.dark.paint, LINE_WIDTH.outline)
const blockedMaterial = edgeMaterial(PAINT_HOVER_COLORS.dark.blocked, LINE_WIDTH.outline)
const hiddenEdgeMaterial = (color: string) =>
  hiddenLineMaterial(color, LINE_WIDTH.light, HIDDEN_EDGES, "selection-outline-hidden")
const hiddenOutlineMaterial = hiddenEdgeMaterial(OUTLINE_COLORS.dark.selected)
const hiddenActiveMaterial = hiddenEdgeMaterial(OUTLINE_COLORS.dark.active)

/** A fill for faces that draw from the front, and one for two-sided ones (glass), so it shades what the mesh draws. */
interface Fill {
  readonly front: THREE.MeshBasicMaterial
  readonly double: THREE.MeshBasicMaterial
}
const fillMaterial = (color: string, side: THREE.Side): THREE.MeshBasicMaterial => {
  const material = new THREE.MeshBasicMaterial({
    color,
    side,
    transparent: true,
    opacity: PAINT_HOVER_COLORS.dark.fill,
    depthWrite: false,
    toneMapped: false,
    fog: false
  })
  material.onBeforeCompile = fillShader
  return material
}
const fillOf = (color: string): Fill => ({
  front: fillMaterial(color, THREE.FrontSide),
  double: fillMaterial(color, THREE.DoubleSide)
})
const paintFill = fillOf(PAINT_HOVER_COLORS.dark.paint)
const blockedFill = fillOf(PAINT_HOVER_COLORS.dark.blocked)

/** Recolours every outline for the theme. */
export const setOutlineTheme = (dark: boolean): void => {
  const colors = dark ? OUTLINE_COLORS.dark : OUTLINE_COLORS.light
  outlineMaterial.color.set(colors.selected)
  activeOutlineMaterial.color.set(colors.active)
  hiddenOutlineMaterial.color.set(colors.selected)
  hiddenActiveMaterial.color.set(colors.active)
  const hover = dark ? PAINT_HOVER_COLORS.dark : PAINT_HOVER_COLORS.light
  hoverMaterial.color.set(hover.paint)
  paintMaterial.color.set(hover.paint)
  blockedMaterial.color.set(hover.blocked)
  for (const [fill, color] of [[paintFill, hover.paint], [blockedFill, hover.blocked]] as const) {
    for (const material of [fill.front, fill.double]) {
      material.color.set(color)
      material.opacity = hover.fill
    }
  }
}

/** The fill for `mesh`: two-sided where the mesh's own material is. */
const fillFor = (fill: Fill, mesh: THREE.Mesh): THREE.MeshBasicMaterial => {
  const own = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  return own === undefined || own.side === THREE.FrontSide ? fill.front : fill.double
}

const everyMesh = () => true

/** Every outline's own lines and fills: under the item, but no part of it, so no outline outlines a fill. */
const outlineParts = new WeakSet<THREE.Object3D>()

/** Whether `object` is an outline's line or fill: drawn under an item, but no part of it. Its lines are meshes too. */
export const isOutlinePart = (object: THREE.Object3D): boolean => outlineParts.has(object)

const inverse = new THREE.Matrix4()

/** How one item is outlined: the line material, the hidden part's (none: not shown through), and the faces' fill. */
interface Look {
  readonly line: LineMaterial
  readonly hidden: LineMaterial | undefined
  readonly fill: Fill | undefined
}

/** The outline of one item: add it to the item, then `update` it from that item. Never raycast. */
export class SelectionOutline extends THREE.Group {
  private readonly lines: Array<LineSegments2> = []
  private readonly hiddenLines: Array<LineSegments2> = []
  private readonly fills: Array<THREE.Mesh> = []

  /**
   * Matches the lines to the meshes under `item` (not the fills of any outline) and places each in `item`'s local
   * space. Cheap enough per frame: glbs load async, so the caller keeps it fresh. `active` picks the active item's
   * colour. What hides the item, the outline shows through, dashed.
   */
  update(item: THREE.Object3D, active = false): void {
    this.draw(item, everyMesh, {
      line: active ? activeOutlineMaterial : outlineMaterial,
      hidden: active ? hiddenActiveMaterial : hiddenOutlineMaterial,
      fill: undefined
    })
  }

  /** The select tools' hover: what a click would select, outlined lighter in the pointer's colour where it shows. */
  updateHover(item: THREE.Object3D): void {
    this.draw(item, everyMesh, { line: hoverMaterial, hidden: undefined, fill: undefined })
  }

  /** The paint tool's hover: the meshes under `item` that `shows` picks, outlined and shaded, blocked or not. */
  updatePaintHover(item: THREE.Object3D, shows: (mesh: THREE.Mesh) => boolean, blocked: boolean): void {
    this.draw(item, shows, {
      line: blocked ? blockedMaterial : paintMaterial,
      hidden: undefined,
      fill: blocked ? blockedFill : paintFill
    })
  }

  private draw(item: THREE.Object3D, shows: (mesh: THREE.Mesh) => boolean, look: Look): void {
    item.updateMatrixWorld(true)
    inverse.copy(item.matrixWorld).invert()
    const shown: Array<THREE.Mesh> = []
    item.traverse((object) => {
      if (isMesh(object) && !outlineParts.has(object) && shows(object)) shown.push(object)
    })
    const place = <T extends THREE.Mesh>(
      parts: Array<T>,
      make: () => T,
      count: number,
      dress: (part: T, mesh: THREE.Mesh) => void
    ) => {
      shown.slice(0, count).forEach((mesh, i) => {
        const part = parts[i] ?? this.kept(parts, make())
        dress(part, mesh)
        part.matrix.multiplyMatrices(inverse, mesh.matrixWorld)
        if (part.parent !== this) this.add(part)
      })
      for (const extra of parts.slice(count)) extra.removeFromParent()
    }
    const lineOf = (material: LineMaterial) => (line: LineSegments2, mesh: THREE.Mesh) => {
      line.geometry = outlineOf(mesh.geometry)
      line.material = material
    }
    const newLine = () => new LineSegments2(undefined, outlineMaterial)
    place(this.lines, newLine, shown.length, lineOf(look.line))
    const { hidden, fill } = look
    place(this.hiddenLines, newLine, hidden === undefined ? 0 : shown.length, lineOf(hidden ?? outlineMaterial))
    place(this.fills, () => new THREE.Mesh(), fill === undefined ? 0 : shown.length, (face, mesh) => {
      face.geometry = mesh.geometry
      if (fill !== undefined) face.material = fillFor(fill, mesh)
    })
    this.visible = shown.length > 0
  }

  /** A new line or fill, kept for reuse: placed by the matrix it is given, never raycast, and never outlined. */
  private kept<T extends THREE.Mesh>(parts: Array<T>, object: T): T {
    object.matrixAutoUpdate = false
    object.raycast = () => {}
    outlineParts.add(object)
    parts.push(object)
    return object
  }
}
