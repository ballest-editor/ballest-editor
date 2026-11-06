/** The viewport's clear colour per theme. */
export const SCENE_COLORS = { dark: "#1d2128", light: "#e9ecf1" } as const

/** The box around a whole group: magenta, far from the selection's amber and the gizmo's axes, on any floor or sky. */
export const GROUP_BOX_COLORS = { dark: "#ff3dc8", light: "#c2129a" } as const

/** The same as Tailwind classes, spelled out so Tailwind picks them up: what shows before and around the canvas. */
export const sceneBackgroundClass = "bg-[#e9ecf1] dark:bg-[#1d2128]"

/** The same colours as an SVG stroke, for a halo that keeps overlay text readable over the scene. */
export const sceneStrokeClass = "stroke-[#e9ecf1] dark:stroke-[#1d2128]"
