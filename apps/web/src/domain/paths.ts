/** `name` in `folder`, for showing: with the separator the folder already uses, so a Windows path stays one. */
export const pathInFolder = (folder: string, name: string): string =>
  `${folder}${folder.includes("\\") ? "\\" : "/"}${name}`

const segmentsOf = (path: string): ReadonlyArray<string> => path.split(/[\\/]/).filter((segment) => segment !== "")

/** The name of the folder `path` is in, for a row that shows where a project is without its whole path. */
export const parentFolderName = (path: string): string => segmentsOf(path).at(-2) ?? path

/** The last two folders of `path`, the short way to say where a folder is: `Ballest Editor/Season 3 tracks`. */
export const shortFolderName = (path: string): string => segmentsOf(path).slice(-2).join("/")
