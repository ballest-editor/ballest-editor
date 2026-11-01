import type { MapLink } from "@ballest/contracts"

/**
 * What looking at a map's export did (docs/PROJECTS.md § Sync): `changed`, the game changed it since the last export
 * and this is the first look that saw this version; `missing`, it is gone, so the link's export was dropped.
 */
export type ExportReport = "changed" | "missing"

/** A link after its export was looked at, and what to report about it (null: nothing new). */
export interface SeenExport {
  readonly link: MapLink
  readonly report: ExportReport | null
}

/**
 * The link after the editor looked at its export: `gameHash` is the export's hash now, null when the file is gone.
 * Any byte the game changed counts, `editorState` too, which the game rewrites on every save. The hash seen is kept
 * in `lastSeenHash`, so the same version of the file is reported once however often it is looked at; a game file back
 * to the exported bytes is in sync again. A missing export drops `export` (and `lastSeenHash`); `origin` stays.
 */
export const seeExport = (link: MapLink, gameHash: string | null): SeenExport => {
  if (link.export === null) return { link, report: null }
  if (gameHash === null) return { link: { ...link, export: null, lastSeenHash: null }, report: "missing" }
  if (gameHash === link.lastSeenHash) return { link, report: null }
  return { link: { ...link, lastSeenHash: gameHash }, report: gameHash === link.export.hash ? null : "changed" }
}
