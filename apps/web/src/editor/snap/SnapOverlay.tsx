/**
 * What snapping draws in the scene (docs/SNAPPING.md § What a drag looks like): the current target and the base, and what
 * stays on the map: construction geometry, measurements, acquired tracking points and open ends. Everything draws over
 * the scene and stays one size on screen, so it reads the same in every pane.
 */
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import type { Vec3 } from "../../domain/coords"
import type { Construction, Measurement } from "../../domain/MapSidecar"
import type { SnapMark, TrackedPoint } from "../../domain/snapFrame"
import { measurementFacts } from "../../domain/snapTools"
import { annotationsOf } from "../../domain/structure"
import { vecAdd, vecCross, vecLerp, vecScale } from "../../domain/ueMath"
import { sceneAxisColors } from "../axisColors"
import { useBeforePaneDraw } from "../PaneRenderer"
import { snapConfigOf, useEditor } from "../store"
import { useDarkTheme } from "../theme"
import { isLine, isMesh } from "../threeGuards"
import { endsInDoc, ringedEnds } from "./openEnds"
import { snapMarks } from "./snapMarks"
import { toThree } from "./snapView"

/** Over the map and the orthographic grid, under the gizmo. */
const RENDER_ORDER = 960

/** On screen, in pixels. */
const DOT = 9
const RING = 16
const PLUS = 7
const DASH = 7
const LABEL_HEIGHT = 20
/** The label's texture pixels to a pixel on screen, to stay sharp on a high-density display. */
const LABEL_DENSITY = 3

const COLORS = {
  target: "#ffc940",
  base: "#ffffff",
  guide: "#ff5fa8",
  end: "#38d6c4",
  open: "#ff9f43",
  construction: "#6aa6ff",
  measurement: "#ffe08a"
} as const

const look = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false } as const

const pointGeometry = (points: ReadonlyArray<Vec3>) => new THREE.BufferGeometry().setFromPoints(points.map(toThree))

const dotGeometry = new THREE.CircleGeometry(0.5, 20)
const ringGeometry = new THREE.RingGeometry(0.4, 0.5, 32)
const plusGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 1, 0)
])

/** An object held to a size on screen, turned to face the pane. */
interface Sized {
  readonly object: THREE.Object3D
  /** Pixels across, or width and height. */
  readonly size: number | readonly [number, number]
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

const SHARED_SHAPES: ReadonlySet<THREE.BufferGeometry> = new Set([dotGeometry, ringGeometry, plusGeometry])

/** Lets go of what a mark made for itself; the shared shapes stay for the next one, and so do a label's. */
const disposeMark = (object: THREE.Object3D) => {
  if (object instanceof THREE.Sprite) object.material.dispose()
  if (!isMesh(object) && !isLine(object)) return
  if (!SHARED_SHAPES.has(object.geometry)) object.geometry.dispose()
  const { material } = object
  if (!Array.isArray(material)) material.dispose()
}

/** One layer of marks, rebuilt only when what it shows changes. */
class MarkLayer extends THREE.Group {
  private sized: Array<Sized> = []
  private dashed: Array<THREE.LineDashedMaterial> = []

  private put<T extends THREE.Object3D>(object: T): T {
    object.renderOrder = RENDER_ORDER
    object.raycast = () => {}
    this.add(object)
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

  ring(at: Vec3, color: string): void {
    const mesh = this.put(
      new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ ...look, color, side: THREE.DoubleSide }))
    )
    mesh.position.copy(toThree(at))
    this.sized.push({ object: mesh, size: RING })
  }

  plus(at: Vec3, color: string): void {
    const lines = this.put(new THREE.LineSegments(plusGeometry, new THREE.LineBasicMaterial({ ...look, color })))
    lines.position.copy(toThree(at))
    this.sized.push({ object: lines, size: PLUS })
  }

  line(from: Vec3, to: Vec3, color: string): void {
    this.put(new THREE.LineSegments(pointGeometry([from, to]), new THREE.LineBasicMaterial({ ...look, color })))
  }

  dashedLine(from: Vec3, to: Vec3, color: string): void {
    const material = new THREE.LineDashedMaterial({ ...look, color, dashSize: DASH, gapSize: DASH })
    const lines = this.put(new THREE.LineSegments(pointGeometry([from, to]), material))
    lines.computeLineDistances()
    this.dashed.push(material)
  }

  face(corners: ReadonlyArray<Vec3>, color: string, opacity = 0.28): void {
    const [first] = corners
    if (first === undefined || corners.length < 3) return
    const points = corners.slice(1, -1).flatMap((corner, i) => [first, corner, corners[i + 2] ?? corner])
    const material = new THREE.MeshBasicMaterial({ ...look, color, opacity, side: THREE.DoubleSide })
    this.put(new THREE.Mesh(pointGeometry(points), material))
  }

  label(at: Vec3, text: string): void {
    const { texture, width } = labelTexture(text)
    const sprite = this.put(new THREE.Sprite(new THREE.SpriteMaterial({ ...look, map: texture })))
    sprite.position.copy(toThree(at))
    this.sized.push({ object: sprite, size: [width, LABEL_HEIGHT] })
  }

  /** Sizes what stays one size for a pane showing `worldPerPixel` cm to the pixel here. */
  fit(worldPerPixelAt: (point: THREE.Vector3) => number, camera: THREE.Camera): void {
    for (const { object, size } of this.sized) {
      const perPixel = worldPerPixelAt(object.position)
      if (typeof size === "number") {
        object.quaternion.copy(camera.quaternion)
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

const drawMark = (layer: MarkLayer, mark: SnapMark, dark: boolean) => {
  switch (mark.kind) {
    case "dot":
      layer.dot(mark.at, COLORS.target)
      return
    case "line":
      layer.line(mark.from, mark.to, COLORS.target)
      return
    case "face":
      layer.face(mark.corners, COLORS.target)
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
    case "ring":
      layer.ring(mark.at, COLORS.end)
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
  const dark = useDarkTheme(useEditor((s) => s.settings.appearance.theme))
  const persistent = useMemo(() => new MarkLayer(), [])
  /** The open ends, apart: a drag moves them on every event. */
  const rings = useMemo(() => new MarkLayer(), [])
  const transient = useMemo(() => new MarkLayer(), [])

  const docEnds = useMemo(() => showOpen === "never" ? [] : endsInDoc(doc, index), [doc, index, showOpen])
  const open = useMemo(
    () => ringedEnds({ doc, catalogIndex: index, preview, hoveredItem: hovered }, showOpen, docEnds),
    [doc, index, preview, hovered, showOpen, docEnds]
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
    for (const { position } of open) rings.ring(position, COLORS.open)
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
