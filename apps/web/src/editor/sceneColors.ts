/** The viewport's clear colour per theme. */
export const SCENE_COLORS = { dark: "#1d2128", light: "#e9ecf1" } as const

/** The box around a whole group: magenta, far from the selection's amber and the gizmo's axes, on any floor or sky. */
export const GROUP_BOX_COLORS = { dark: "#ff3dc8", light: "#c2129a" } as const

/** The sky a perspective pane draws when the map's own is hidden: never a flat band above the floor. */
export const THEME_SKY_COLORS = {
  dark: { zenith: "#10141b", horizon: "#3f4b5c" },
  light: { zenith: "#8db6e2", horizon: "#f7f9fb" }
} as const

/** The same as Tailwind classes, spelled out so Tailwind picks them up: what shows before and around the canvas. */
export const sceneBackgroundClass = "bg-[#e9ecf1] dark:bg-[#1d2128]"
