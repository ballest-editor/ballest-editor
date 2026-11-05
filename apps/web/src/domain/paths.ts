/** `name` in `folder`, for showing: with the separator the folder already uses, so a Windows path stays one. */
export const pathInFolder = (folder: string, name: string): string =>
  `${folder}${folder.includes("\\") ? "\\" : "/"}${name}`
