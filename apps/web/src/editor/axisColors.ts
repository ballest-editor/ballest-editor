/**
 * The one set of axis colours (Blender's theme: X red, Y green, Z blue; Z is up in the game),
 * used by the gizmo and every X/Y/Z control in the UI.
 */
export const AXIS_COLORS = { x: "#ff3653", y: "#8adb00", z: "#2c8fff" } as const

/** The same colours as Tailwind background classes (spelled out so Tailwind picks them up). */
export const AXIS_BG_CLASSES = { x: "bg-[#ff3653]", y: "bg-[#8adb00]", z: "bg-[#2c8fff]" } as const
