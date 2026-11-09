/**
 * What the editor draws over the scene, by what it means (docs/design/ui-system.md § Scene colours). One hue per
 * meaning, so a colour says the same thing on an outline, a box, a snap mark or an open end:
 *
 * - `selected`: amber, what an edit acts on, as in the game's own editor, Unreal, Unity and Blender. `active` is the
 *   active item, lighter on a dark scene and darker on a pale one;
 * - `pointer`: cyan, what a click or a drop would act on, the chrome's own interactive hue: the hover, the paint tool's
 *   target, what a snap lands on;
 * - `blocked`: red, where the pointer's action won't go;
 * - `reference`: violet, what is drawn to measure by and isn't in the map's pieces: guides and construction geometry;
 * - `context`: no hue, what frames the work and isn't a choice: the entered group, the pivot dot.
 *
 * The axes keep their own colours (axisColors.ts), and the paint swatches the game's.
 */
export const SCENE_ROLES = {
  dark: {
    selected: "#ffb020",
    active: "#ffe08a",
    pointer: "#5ce1ff",
    blocked: "#ff5a5f",
    reference: "#b69cff",
    context: "#ffffff"
  },
  light: {
    selected: "#c2500a",
    active: "#7a2e05",
    pointer: "#0a6f94",
    blocked: "#c0182a",
    reference: "#6236c9",
    context: "#1f2430"
  }
} as const

export type SceneRole = keyof typeof SCENE_ROLES.dark

/** The roles in a theme. */
export const sceneRoles = (dark: boolean): Readonly<Record<SceneRole, string>> => SCENE_ROLES[dark ? "dark" : "light"]

/** The same as Tailwind classes, spelled out so Tailwind picks them up: what shows before and around the canvas. */
export const sceneBackgroundClass = "bg-[#d0e4ef] dark:bg-[#0f242f]"
