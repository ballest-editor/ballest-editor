/**
 * What snapping draws in the scene (docs/SNAPPING.md § Snap indications): the current snap, its source and target
 * each in its own colour with the glyph of its kind, or the base while nothing is in range; and what stays on the map:
 * construction geometry, measurements, acquired tracking points and open ends. Everything draws over the scene and stays
 * one size on screen, so it reads the same in every pane, but for a side's box, which sits in the scene.
 */
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import type { Vec3 } from "../../domain/coords"
import type { Construction, Measurement } from "../../domain/MapSidecar"
import type { SnapMark, SnapRelation, TrackedPoint } from "../../domain/snapFrame"
import { measurementFacts } from "../../domain/snapTools"
import { annotationsOf } from "../../domain/structure"
import { vecAdd, vecCross, vecLerp, vecScale } from "../../domain/ueMath"
import { sceneAxisColors } from "../axisColors"
import { useBeforePaneDraw } from "../PaneRenderer"
import { snapConfigOf, useEditor } from "../store"
import { useDarkTheme } from "../theme"
import { isLine, isMesh } from "../threeGuards"
import { endsInDoc, ringedEnds } from "./openEnds"
import { GLYPHS, glyphSegments, roleColor, SNAP_COLORS as COLORS } from "./snapGlyphs"
import { snapMarks } from "./snapMarks"
import { toThree } from "./snapView"

/** Over the map and the orthographic grid, under the gizmo. */
const RENDER_ORDER = 960

/** On screen, in pixels. */
const DOT = 9
const RING = 16
/** A source's point rings the target's dot, and a source's end rings the target's end. */
const SOURCE_POINT = 16
const SOURCE_END = 25
const PLUS = 7
const DASH = 7
/** An edge's end ticks. */
const TICK = 9
/** The glyph's badge, its offset up and right of the landing, and the glyph in it. */
const BADGE = 22
const BADGE_OFFSET = 20
const GLYPH = 15
const LABEL_HEIGHT = 20
/** The label's texture pixels to a pixel on screen, to stay sharp on a high-density display. */
const LABEL_DENSITY = 3

/** A snapping face's tint, light enough to see the piece through. */
const FACE_TINT = 0.16
/** A box's edges where the scene in front hides them, and where it doesn't. */
const BOX_HIDDEN = 0.3
const BOX_SHOWN = 0.85

/** A box's twelve edges, as pairs of the corners `cornersOf` lists: those that differ along one axis. */
const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [
  3,
  7
]] as const

/** Over the target: the source, then the glyph's badge, then the glyph. */
const ABOVE = { target: 0, source: 1, badge: 2, glyph: 3 } as const

const look = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false } as const

const pointGeometry = (points: ReadonlyArray<Vec3>) => new THREE.BufferGeometry().setFromPoints(points.map(toThree))

const flatGeometry = (points: ReadonlyArray<readonly [number, number]>) =>
  new THREE.BufferGeometry().setFromPoints(points.map(([x, y]) => new THREE.Vector3(x, y, 0)))

const dotGeometry = new THREE.CircleGeometry(0.5, 20)
const ringGeometry = new THREE.RingGeometry(0.4, 0.5, 32)
const plusGeometry = flatGeometry([[-1, 0], [1, 0], [0, -1], [0, 1]])
/** Across the edge once turned along it. */
const tickGeometry = flatGeometry([[0, -0.5], [0, 0.5]])

/** A glyph's strokes in a unit box about the origin, y up: lines, and its dots filled. */
const glyphGeometry = (relation: SnapRelation) => {
  const unit = (x: number, y: number) => [(x - 12) / 24, (12 - y) / 24] as const
  const segments = glyphSegments(GLYPHS[relation]).flatMap(([x1, y1, x2, y2]) => [unit(x1, y1), unit(x2, y2)])
  const dots = GLYPHS[relation].flatMap((stroke) => {
    if (!("dot" in stroke)) return []
    const [cx, cy, r] = stroke.dot
    const steps = 16
    const rim = (i: number) =>
      unit(cx + r * Math.cos(i / steps * Math.PI * 2), cy + r * Math.sin(i / steps * Math.PI * 2))
    return Array.from({ length: steps }, (_, i) => [unit(cx, cy), rim(i), rim(i + 1)]).flat()
  })
  return { lines: flatGeometry(segments), fill: dots.length === 0 ? undefined : flatGeometry(dots) }
}

/** Every shape the marks share, which outlive the marks that use them. */
const SHARED_SHAPES = new Set<THREE.BufferGeometry>()

const glyphGeometries = new Map<SnapRelation, ReturnType<typeof glyphGeometry>>()

/** A glyph's shapes, made the first time it shows. */
const glyphShapes = (relation: SnapRelation) => {
  const kept = glyphGeometries.get(relation)
  if (kept !== undefined) return kept
  const made = glyphGeometry(relation)
  glyphGeometries.set(relation, made)
  SHARED_SHAPES.add(made.lines)
  if (made.fill !== undefined) SHARED_SHAPES.add(made.fill)
  return made
}

/** An object held to a size on screen, turned to face the pane. */
interface Sized {
  readonly object: THREE.Object3D
  /** Pixels across, or width and height. */
  readonly size: number | readonly [number, number]
  /** A direction in the scene its x runs along on screen, as an edge's ticks do. */
  readonly along?: THREE.Vector3
}

const labelTextures = new Map<string, { readonly texture: THREE.CanvasTexture; readonly width: number }>()

/** A label's picture, kept for the next time the same words come up. */
const labelTexture = (text: string) => {
  const kept = labelTextures.get(text)
  if (kept !== undefined) return kept
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  const font = "600 12px system-ui, sans-serif"
  if (context !== null) context.font = font
  const width = Math.ceil((context?.measureText(text).width ?? text.length * 7) + 14)
  canvas.width = width * LABEL_DENSITY
  canvas.height = LABEL_HEIGHT * LABEL_DENSITY
  if (context !== null) {
    context.scale(LABEL_DENSITY, LABEL_DENSITY)
    context.fillStyle = "rgba(16, 18, 24, 0.82)"
    context.beginPath()
    context.roundRect(0, 0, width, LABEL_HEIGHT, LABEL_HEIGHT / 2)
    context.fill()
    context.fillStyle = "#ffffff"
    context.font = font
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(text, width / 2, LABEL_HEIGHT / 2 + 1)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const entry = { texture, width }
  labelTextures.set(text, entry)
  return entry
}

for (const shape of [dotGeometry, ringGeometry, plusGeometry, tickGeometry]) SHARED_SHAPES.add(shape)

/** A direction in game space as the scene's, unit length. */
const sceneDirection = (direction: Vec3) => toThree(direction).sub(toThree({ x: 0, y: 0, z: 0 })).normalize()

const toCamera = new THREE.Quaternion()
const onScreen = new THREE.Vector3()
const turnOnScreen = new THREE.Quaternion()
const SCREEN_NORMAL = new THREE.Vector3(0, 0, 1)

/** Lets go of what a mark made for itself; the shared shapes stay for the next one, and so do a label's. */
const disposeMark = (object: THREE.Object3D) => {
  if (object instanceof THREE.Sprite) object.material.dispose()
  if (!isMesh(object) && !isLine(object)) return
  if (!SHARED_SHAPES.has(object.geometry)) object.geometry.dispose()
  const { material } = object
  if (!Array.isArray(material)) material.dispose()
}

/** One layer of marks, rebuilt only when what it shows changes. */
export class MarkLayer extends THREE.Group {
  private sized: Array<Sized> = []
  private dashed: Array<THREE.LineDashedMaterial> = []

  private put<T extends THREE.Object3D>(object: T, above = 0, into: THREE.Object3D = this): T {
    object.renderOrder = RENDER_ORDER + above
    object.raycast = () => {}
    into.add(object)
    return object
  }

  reset(): void {
    for (const child of this.children) child.traverse(disposeMark)
    this.clear()
    this.sized = []
    this.dashed = []
  }

  dot(at: Vec3, color: string, size = DOT): void {
    const mesh = this.put(new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ ...look, color })))
    mesh.position.copy(toThree(at))
    this.sized.push({ object: mesh, size })
  }

  ring(at: Vec3, color: string, size = RING, above = 0): void {
    const mesh = this.put(
      new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ ...look, color, side: THREE.DoubleSide })),
      above
    )
    mesh.position.copy(toThree(at))
    this.sized.push({ object: mesh, size })
  }

  plus(at: Vec3, color: string): void {
    const lines = this.put(new THREE.LineSegments(plusGeometry, new THREE.LineBasicMaterial({ ...look, color })))
    lines.position.copy(toThree(at))
    this.sized.push({ object: lines, size: PLUS })
  }

  line(from: Vec3, to: Vec3, color: string, above = 0): void {
    this.put(new THREE.LineSegments(pointGeometry([from, to]), new THREE.LineBasicMaterial({ ...look, color })), above)
  }

  /** A short screen-sized object at `at`, its x along the scene direction `along`. */
  private alongOnScreen(geometry: THREE.BufferGeometry, at: Vec3, along: Vec3, size: number, color: string): void {
    const lines = this.put(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ ...look, color })), 1)
    lines.position.copy(toThree(at))
    this.sized.push({ object: lines, size, along: sceneDirection(along) })
  }

  /** An edge with a tick across each end, to tell it from a guide. */
  edge(from: Vec3, to: Vec3, color: string, above = 0): void {
    this.line(from, to, color, above)
    const along = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
    for (const end of [from, to]) this.alongOnScreen(tickGeometry, end, along, TICK, color)
  }

  /**
   * A side's whole box, by its eight corners in `cornersOf`'s order: thin and grey, and faint where the scene in front
   * hides it, so it reads through the pieces as the gizmo does and still shows what is in front of what.
   */
  box(corners: ReadonlyArray<Vec3>, color: string): void {
    const edges = BOX_EDGES.flatMap(([a, b]) => [corners[a], corners[b]].flatMap((corner) => corner ?? []))
    if (edges.length !== BOX_EDGES.length * 2) return
    const geometry = pointGeometry(edges)
    this.put(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ ...look, color, opacity: BOX_HIDDEN })))
    const shown = { ...look, depthTest: true, color, opacity: BOX_SHOWN }
    this.put(new THREE.LineSegments(geometry.clone(), new THREE.LineBasicMaterial(shown)))
  }

  /** The glyph of a snap's kind, white on a dark badge up and right of `at`. */
  glyph(relation: SnapRelation, at: Vec3): void {
    const shapes = glyphShapes(relation)
    const badge = this.put(new THREE.Group())
    badge.position.copy(toThree(at))
    const placed = (object: THREE.Mesh | THREE.LineSegments, size: number, above: number) => {
      this.put(object, above, badge)
      object.scale.setScalar(size)
      return object
    }
    const disc = new THREE.MeshBasicMaterial({ ...look, color: "#101218", opacity: 0.82 })
    const ink = { ...look, color: COLORS.base }
    const parts = [
      placed(new THREE.Mesh(dotGeometry, disc), BADGE, ABOVE.badge),
      placed(new THREE.LineSegments(shapes.lines, new THREE.LineBasicMaterial(ink)), GLYPH, ABOVE.glyph),
      ...(shapes.fill === undefined
        ? []
        : [placed(new THREE.Mesh(shapes.fill, new THREE.MeshBasicMaterial(ink)), GLYPH, ABOVE.glyph)])
    ]
    for (const part of parts) part.position.set(BADGE_OFFSET, BADGE_OFFSET, 0)
    // a pixel to a unit: the badge's parts are laid out in pixels
    this.sized.push({ object: badge, size: 1 })
  }

  dashedLine(from: Vec3, to: Vec3, color: string): void {
    const material = new THREE.LineDashedMaterial({ ...look, color, dashSize: DASH, gapSize: DASH })
    const lines = this.put(new THREE.LineSegments(pointGeometry([from, to]), material))
    lines.computeLineDistances()
    this.dashed.push(material)
  }

  face(corners: ReadonlyArray<Vec3>, color: string, opacity = FACE_TINT, above = 0): void {
    const [first] = corners
    if (first === undefined || corners.length < 3) return
    const points = corners.slice(1, -1).flatMap((corner, i) => [first, corner, corners[i + 2] ?? corner])
    const material = new THREE.MeshBasicMaterial({ ...look, color, opacity, side: THREE.DoubleSide })
    this.put(new THREE.Mesh(pointGeometry(points), material), above)
  }

  outline(corners: ReadonlyArray<Vec3>, color: string, above = 0): void {
    const loop = corners.flatMap((corner, i) => [corner, corners[(i + 1) % corners.length] ?? corner])
    this.put(new THREE.LineSegments(pointGeometry(loop), new THREE.LineBasicMaterial({ ...look, color })), above)
  }

  label(at: Vec3, text: string): void {
    const { texture, width } = labelTexture(text)
    const sprite = this.put(new THREE.Sprite(new THREE.SpriteMaterial({ ...look, map: texture })))
    sprite.position.copy(toThree(at))
    this.sized.push({ object: sprite, size: [width, LABEL_HEIGHT] })
  }

  /** Sizes what stays one size for a pane showing `worldPerPixel` cm to the pixel here. */
  fit(worldPerPixelAt: (point: THREE.Vector3) => number, camera: THREE.Camera): void {
    toCamera.copy(camera.quaternion).invert()
    for (const { along, object, size } of this.sized) {
      const perPixel = worldPerPixelAt(object.position)
      if (typeof size === "number") {
        object.quaternion.copy(camera.quaternion)
        if (along !== undefined) {
          onScreen.copy(along).applyQuaternion(toCamera)
          object.quaternion.multiply(turnOnScreen.setFromAxisAngle(SCREEN_NORMAL, Math.atan2(onScreen.y, onScreen.x)))
        }
        object.scale.setScalar(perPixel * size)
      } else {
        object.scale.set(perPixel * size[0], perPixel * size[1], 1)
      }
      object.updateMatrixWorld(true)
    }
    const perPixel = worldPerPixelAt(this.children[0]?.position ?? new THREE.Vector3())
    for (const material of this.dashed) {
      material.dashSize = DASH * perPixel
      material.gapSize = DASH * perPixel
    }
  }
}

/**
 * One mark, in its side's colour: a source's point and end ring the target's, so both show where they meet, and a side's
 * box is grey about its tinted faces.
 */
export const drawMark = (layer: MarkLayer, mark: SnapMark, dark: boolean): void => {
  switch (mark.kind) {
    case "dot":
      if (mark.role === "source") layer.ring(mark.at, COLORS.source, SOURCE_POINT, ABOVE.source)
      else layer.dot(mark.at, COLORS.target)
      return
    case "ring":
      if (mark.role === "source") layer.ring(mark.at, COLORS.source, SOURCE_END, ABOVE.source)
      else layer.ring(mark.at, COLORS.target)
      return
    case "line":
      layer.edge(mark.from, mark.to, roleColor(mark.role), ABOVE[mark.role])
      return
    case "face":
      layer.face(mark.corners, roleColor(mark.role), FACE_TINT, ABOVE[mark.role])
      layer.outline(mark.corners, roleColor(mark.role), ABOVE[mark.role])
      return
    case "box":
      layer.box(mark.corners, COLORS.box)
      return
    case "glyph":
      layer.glyph(mark.relation, mark.at)
      return
    case "guide":
      layer.dashedLine(mark.from, mark.to, COLORS.guide)
      if (mark.text !== undefined) layer.label(vecLerp(mark.from, mark.to, 0.5), mark.text)
      return
    case "tracking": {
      const colors = sceneAxisColors(dark)
      layer.dashedLine(mark.from, mark.to, mark.axis === "view" ? COLORS.target : colors[mark.axis])
      return
    }
  }
}

const planeCorners = ({ extent, normal, origin, xAxis }: Extract<Construction, { kind: "plane" }>) => {
  const y = vecCross(normal, xAxis)
  const corner = (a: number, b: number) => vecAdd(vecAdd(origin, vecScale(xAxis, a * extent)), vecScale(y, b * extent))
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
}

const drawConstruction = (layer: MarkLayer, one: Construction) => {
  if (one.kind === "plane") {
    const corners = planeCorners(one)
    layer.face(corners, COLORS.construction, 0.14)
    corners.forEach((corner, i) => layer.line(corner, corners[(i + 1) % corners.length] ?? corner, COLORS.construction))
    layer.label(corners[2] ?? one.origin, one.name)
    return
  }
  const end = (sign: number) => vecAdd(one.origin, vecScale(one.direction, sign * one.extent))
  layer.line(end(-1), end(1), COLORS.construction)
  layer.label(end(1), one.name)
}

const drawMeasurement = (layer: MarkLayer, { a, angle, b }: Measurement) => {
  layer.line(a, b, COLORS.measurement)
  layer.dot(a, COLORS.measurement, 6)
  layer.dot(b, COLORS.measurement, 6)
  const text = angle === undefined ? `${measurementFacts(a, b).distance.toFixed(1)} cm` : `${angle.toFixed(1)}°`
  layer.label(vecLerp(a, b, 0.5), text)
}

/** What the overlay draws from: the identities that say it changed. */
interface Inputs {
  readonly construction: ReadonlyArray<Construction>
  readonly measurements: ReadonlyArray<Measurement>
  readonly tracked: ReadonlyArray<TrackedPoint>
  readonly dark: boolean
}

export function SnapOverlay() {
  const doc = useEditor((s) => s.doc)
  const index = useEditor((s) => s.catalogIndex)
  const tracked = useEditor((s) => s.tracked)
  const showOpen = useEditor((s) => snapConfigOf(s).targets.connectors.showOpenEnds)
  const hovered = useEditor((s) => s.hoveredItem)
  const preview = useEditor((s) => s.preview)
  const dragSnap = useEditor((s) => s.dragSnap)
  const dark = useDarkTheme(useEditor((s) => s.settings.appearance.theme))
  const persistent = useMemo(() => new MarkLayer(), [])
  /** The open ends, apart: a drag moves them on every event. */
  const rings = useMemo(() => new MarkLayer(), [])
  const transient = useMemo(() => new MarkLayer(), [])

  const docEnds = useMemo(() => showOpen === "never" ? [] : endsInDoc(doc, index), [doc, index, showOpen])
  const open = useMemo(
    () => ringedEnds({ doc, catalogIndex: index, preview, hoveredItem: hovered, dragSnap }, showOpen, docEnds),
    [doc, index, preview, hovered, dragSnap, showOpen, docEnds]
  )
  const inputs: Inputs = useMemo(() => {
    const { construction, measurements } = annotationsOf(doc.structure)
    return { construction, measurements, tracked, dark }
  }, [doc.structure, tracked, dark])

  useEffect(() => {
    persistent.reset()
    for (const one of inputs.construction) drawConstruction(persistent, one)
    for (const one of inputs.measurements) drawMeasurement(persistent, one)
    for (const { at } of inputs.tracked) persistent.plus(at, COLORS.target)
  }, [persistent, inputs])

  useEffect(() => {
    rings.reset()
    for (const { position, role } of open) rings.ring(position, roleColor(role))
  }, [rings, open])

  const shown = useMemo(() => ({ revision: -1 }), [])
  useFrame(() => {
    const { base, marks, revision } = snapMarks.get()
    if (revision === shown.revision) return
    shown.revision = revision
    transient.reset()
    for (const mark of marks) drawMark(transient, mark, dark)
    if (base !== undefined) transient.dot(base, COLORS.base)
  })

  useBeforePaneDraw((pane) => {
    persistent.fit((point) => pane.worldPerPixelAt(point), pane.camera)
    rings.fit((point) => pane.worldPerPixelAt(point), pane.camera)
    transient.fit((point) => pane.worldPerPixelAt(point), pane.camera)
  })
  useEffect(() => () => {
    persistent.reset()
    rings.reset()
    transient.reset()
  }, [persistent, rings, transient])
  return (
    <>
      <primitive object={persistent} />
      <primitive object={rings} />
      <primitive object={transient} />
    </>
  )
}
