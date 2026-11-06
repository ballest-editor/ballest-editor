/** `name` in `folder`, for showing: with the separator the folder already uses, so a Windows path stays one. */
export const pathInFolder = (folder: string, name: string): string =>
  `${folder}${folder.includes("\\") ? "\\" : "/"}${name}`

/** A folder as the user knows it: its own name and the one it is in. The whole path is for a tooltip. */
export const folderLabelOf = (path: string): string =>
  path.split(/[\\/]/).filter((part) => part !== "").slice(-2).join(" › ")
