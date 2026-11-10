/** `name` in `folder`, for showing: with the separator the folder already uses, so a Windows path stays one. */
export const pathInFolder = (folder: string, name: string): string =>
  `${folder}${folder.includes("\\") ? "\\" : "/"}${name}`

export const segmentsOf = (path: string): ReadonlyArray<string> =>
  path.split(/[\\/]/).filter((segment) => segment !== "")

/** A path's last segment: the folder a location row names. */
export const lastSegmentOf = (path: string): string => segmentsOf(path).at(-1) ?? path

/** The name of the folder `path` is in, for a row that shows where a project is without its whole path. */
export const parentFolderName = (path: string): string => segmentsOf(path).at(-2) ?? path

/** The last two folders of `path`, the short way to say where a folder is: `Ballest Editor/Season 3 tracks`. */
export const shortFolderName = (path: string): string => segmentsOf(path).slice(-2).join("/")

/** A folder as the user knows it: its own name and the one it is in. The whole path is for a tooltip. */
export const folderLabelOf = (path: string): string => segmentsOf(path).slice(-2).join(" › ")

/** The whole path of the folder `path` is in, as a recent project's row shows where it is. */
export const parentPathOf = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/, "")
  const end = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return end <= 0 ? trimmed.slice(0, 1) || path : trimmed.slice(0, end)
}
