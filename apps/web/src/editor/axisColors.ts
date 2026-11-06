/**
 * The one set of axis colours (Blender's hues: X red, Y green, Z blue; Z is up in the game), used by the gizmo and every
 * X/Y/Z control in the UI. Each is at 85% of its theme's full chroma, same lightness and hue, so the inspector's X/Y/Z
 * tabs aren't the loudest thing on the panel. A pale scene takes darker ones, or its green can't be read.
 */
const AXIS_COLORS = {
  dark: { x: "#f14f5d", y: "#93d846", z: "#4391ef" },
  light: { x: "#c7333c", y: "#448025", z: "#2665c6" }
} as const

/** The axes' colours over the scene in this theme. */
export const sceneAxisColors = (dark: boolean): Readonly<Record<"x" | "y" | "z", string>> =>
  AXIS_COLORS[dark ? "dark" : "light"]

/** The dark theme's colours as Tailwind background classes (spelled out so Tailwind picks them up). */
export const AXIS_BG_CLASSES = { x: "bg-[#f14f5d]", y: "bg-[#93d846]", z: "bg-[#4391ef]" } as const
