/**
 * A word or two on a dark pill, drawn on a canvas for a sprite in the scene: the snapping overlay's labels and the
 * marker on a chain's first link. Kept per text, so the same words are drawn once.
 */
import * as THREE from "three"

/** On screen, in pixels. */
export const LABEL_HEIGHT = 20
/** The label's texture pixels to a pixel on screen, to stay sharp on a high-density display. */
const LABEL_DENSITY = 3

const labelTextures = new Map<string, { readonly texture: THREE.CanvasTexture; readonly width: number }>()

/** A label's picture and its width on screen, kept for the next time the same words come up. */
export const labelTexture = (text: string) => {
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
