// Loose navigation of the C# tool's JSON dumps (CUE4Parse's own export serialisation, which has no fixed shape).
export type JsonObject = Record<string, unknown>

const isObject = (x: unknown): x is JsonObject => typeof x === "object" && x !== null && !Array.isArray(x)
export const obj = (x: unknown): JsonObject | undefined => (isObject(x) ? x : undefined)
export const arr = (x: unknown): Array<unknown> => (Array.isArray(x) ? x : [])
export const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined)
export const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined)
export const bool = (x: unknown): boolean | undefined => (typeof x === "boolean" ? x : undefined)
export const get = (x: unknown, ...keys: ReadonlyArray<string>): unknown => {
  let cur: unknown = x
  for (const k of keys) {
    cur = obj(cur)?.[k]
    if (cur === undefined) return undefined
  }
  return cur
}

/** `{ObjectName: "Class'Name'", ObjectPath: "/Game/X/Name.0"}` -> `/Game/X/Name.Name`. */
export const refPath = (r: unknown): string | null => {
  const name = str(get(r, "ObjectName"))
  const objectPath = str(get(r, "ObjectPath"))
  if (name === undefined || objectPath === undefined) return null
  const inner = name.split("'")[1]?.split(":").pop()
  return `${objectPath.slice(0, objectPath.lastIndexOf("."))}.${inner}`
}

export const nameOf = (path: string): string => path.split(".").pop() ?? path
