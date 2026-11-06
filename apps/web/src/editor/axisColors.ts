/**
 * The one set of axis colours (Blender's theme: X red, Y green, Z blue; Z is up in the game), used by the gizmo and
 * every X/Y/Z control in the UI. A pale scene takes darker ones, or its green can't be read.
 */
const AXIS_COLORS = {
  dark: { x: "#ff3653", y: "#8adb00", z: "#2c8fff" },
  light: { x: "#d3102f", y: "#3a8200", z: "#0f62d6" }
} as const

/** The axes' colours over the scene in this theme. */
export const sceneAxisColors = (dark: boolean): Readonly<Record<"x" | "y" | "z", string>> =>
  AXIS_COLORS[dark ? "dark" : "light"]

/** The dark theme's colours as Tailwind background classes (spelled out so Tailwind picks them up). */
export const AXIS_BG_CLASSES = { x: "bg-[#ff3653]", y: "bg-[#8adb00]", z: "bg-[#2c8fff]" } as const
