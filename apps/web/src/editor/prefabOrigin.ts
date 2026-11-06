/**
 * The prefab's own (0, 0, 0) in a definition's tab: the point its items' `location`s count from, and so where an
 * instance's gizmo sits. It stays a steady size on screen and shows through the pieces, as the point is often inside them.
 */
import * as THREE from "three"
import { ueToThreeVector } from "../domain/coords"
import { PREFAB_TAB_FRAME } from "../domain/prefab"
import { sceneAxisColors } from "./axisColors"

/** On screen, in pixels: how far each axis runs either way, how thick it is, and the point where they cross. */
const ARM = 36
const BAR = 2
const HUB = 8
const LABEL_WIDTH = 64
const LABEL_HEIGHT = 22
/** The label's texture pixels to a pixel on screen, to stay sharp on a high-density display. */
const LABEL_DENSITY = 3
/** Up and to the right of the hub, in the label's own widths and heights. */
const LABEL_ANCHOR = new THREE.Vector2(-0.12, -0.35)
/** Over the scene and the orthographic grid, under the gizmo. */
const RENDER_ORDER = 950

const AXES = ["x", "y", "z"] as const

const overlayLook = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false } as const

/** The label's picture. Apart from the marker because it needs a page to draw on. */
export const originLabelTexture = (): THREE.Texture => {
  const canvas = document.createElement("canvas")
  canvas.width = LABEL_WIDTH * LABEL_DENSITY
  canvas.height = LABEL_HEIGHT * LABEL_DENSITY
  const context = canvas.getContext("2d")
  if (context !== null) {
    context.scale(LABEL_DENSITY, LABEL_DENSITY)
    context.fillStyle = "rgba(16, 18, 24, 0.8)"
    context.beginPath()
    context.roundRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT, LABEL_HEIGHT / 2)
    context.fill()
    context.fillStyle = "#ffffff"
    context.font = "600 13px system-ui, sans-serif"
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText("0, 0, 0", LABEL_WIDTH / 2, LABEL_HEIGHT / 2 + 1)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const barOf = (axis: typeof AXES[number]) => {
  const { x, y, z } = ueToThreeVector({ x: 0, y: 0, z: 0, [axis]: 1 })
  const length = (along: number) => along === 1 ? ARM * 2 : BAR
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(length(x), length(y), length(z)),
    new THREE.MeshBasicMaterial(overlayLook)
  )
  bar.renderOrder = RENDER_ORDER
  return bar
}

/** Put it in the scene, then `fitTo` each pane before it draws. */
export class PrefabOrigin extends THREE.Group {
  readonly bars = AXES.map(barOf)
  private readonly hub = new THREE.Mesh(
    new THREE.SphereGeometry(HUB / 2),
    new THREE.MeshBasicMaterial({ ...overlayLook, color: "#ffffff" })
  )
  private readonly label: THREE.Sprite

  constructor(labelTexture: THREE.Texture) {
    super()
    const { x, y, z } = ueToThreeVector(PREFAB_TAB_FRAME)
    this.position.set(x, y, z)
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ ...overlayLook, map: labelTexture }))
    this.label.center.copy(LABEL_ANCHOR)
    this.label.scale.set(LABEL_WIDTH, LABEL_HEIGHT, 1)
    this.hub.renderOrder = RENDER_ORDER
    this.label.renderOrder = RENDER_ORDER
    this.add(...this.bars, this.hub, this.label)
    this.setDark(true)
  }

  setDark(dark: boolean): void {
    const colors = sceneAxisColors(dark)
    this.bars.forEach((bar, i) => bar.material.color.set(colors[AXES[i] ?? "x"]))
  }

  /** Sizes it for a pane showing `worldPerPixel` cm to the pixel here. The scene works out its matrices once a frame. */
  fitTo(worldPerPixel: number): void {
    this.scale.setScalar(worldPerPixel)
    this.updateMatrixWorld(true)
  }

  override dispose(): void {
    for (const mesh of [...this.bars, this.hub]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    this.label.material.map?.dispose()
    this.label.material.dispose()
    super.dispose()
  }
}
