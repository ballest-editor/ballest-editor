/** The viewport's clear colour per theme. */
export const SCENE_COLORS = { dark: "#1d2128", light: "#e9ecf1" } as const

/**
 * The same colours as Tailwind classes (spelled out so Tailwind picks them up), for the
 * viewport container: it shows before the canvas has drawn anything, and through any strip
 * the canvas hasn't covered yet during a resize.
 */
export const sceneBackgroundClass = "bg-[#e9ecf1] dark:bg-[#1d2128]"
