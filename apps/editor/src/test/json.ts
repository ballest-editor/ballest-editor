import { Predicate } from "effect"

/** Parses JSON text without letting `any` leak into the test. */
export const parseJson = (text: string): unknown => JSON.parse(text)

/** The object at `path` inside parsed JSON; throws when the path doesn't lead to one. */
export const objectAt = (value: unknown, ...path: ReadonlyArray<string | number>): { [key: PropertyKey]: unknown } => {
  let current = value
  for (const key of path) {
    current = Array.isArray(current) && typeof key === "number"
      ? current[key]
      : Predicate.isObject(current)
      ? current[key]
      : undefined
  }
  if (!Predicate.isObject(current)) throw new Error(`no object at ${path.join(".")}`)
  return current
}
