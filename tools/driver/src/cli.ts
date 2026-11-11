import { Effect, Option, Predicate, Stream } from "effect"
import { Tool, type Toolkit } from "effect/ai"
import { DriverError, fail } from "./slots.ts"

// The MCP server's tools from a shell (`pnpm driver tools`, `pnpm driver tool <name> '<json>'`): the same toolkit and
// handlers `serve` exposes, so a session that needs the game reaches them without registering the server.

interface JsonSchema {
  readonly type?: string
  readonly enum?: ReadonlyArray<unknown>
  readonly anyOf?: ReadonlyArray<JsonSchema>
  readonly items?: JsonSchema
  readonly prefixItems?: ReadonlyArray<JsonSchema>
  readonly properties?: Record<string, JsonSchema>
  readonly required?: ReadonlyArray<string>
}

/** A parameter's type in a line: `number`, `"headless" | "window"`, `string[]`, `[number, number, number]`. */
const typeOf = (s: JsonSchema): string => {
  if (s.enum !== undefined) return s.enum.map((v) => JSON.stringify(v)).join(" | ")
  if (s.anyOf !== undefined) return s.anyOf.filter((a) => a.type !== "null").map(typeOf).join(" | ")
  if (s.prefixItems !== undefined) return `[${s.prefixItems.map(typeOf).join(", ")}]`
  if (s.type === "array") return `${s.items === undefined ? "unknown" : typeOf(s.items)}[]`
  return s.type ?? "unknown"
}

/** Every tool with its parameters (`?` where optional) and its description. */
export const describeTools = (tools: Record<string, Tool.Any>): string =>
  Object.values(tools).map((tool) => {
    const schema = Tool.getJsonSchema(tool) as JsonSchema
    const required = new Set(schema.required ?? [])
    const params = Object.entries(schema.properties ?? {}).map(([name, p]) =>
      `${name}${required.has(name) ? "" : "?"}: ${typeOf(p)}`
    )
    return `${tool.name} {${params.join(", ")}}\n  ${tool.description ?? ""}`
  }).join("\n\n")

/** A tool's parameters as the command line gives them: a JSON object, `{}` when left out. */
export const parseParams = (text: string | undefined): Effect.Effect<Record<string, unknown>, DriverError> => {
  if (text === undefined || text.trim() === "") return Effect.succeed({})
  return Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (e) => fail(`the parameters aren't valid JSON (${e instanceof Error ? e.message : String(e)}): ${text}`)
  }).pipe(Effect.filterOrFail(
    Predicate.isObject,
    () => fail(`the parameters must be a JSON object, like '{"slot":1}': ${text}`)
  ))
}

/** What went wrong, in one line: a DriverError as is, the toolkit's own errors (bad parameters) by their message. */
const toDriverError = (e: unknown): DriverError =>
  e instanceof DriverError
    ? e
    : fail(typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e))

/**
 * Runs one tool through the toolkit's handlers, which decode the parameters with the tool's own schema, and returns
 * its result encoded as the MCP server would send it.
 */
export const runTool = <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
  name: string,
  params: Record<string, unknown>
) =>
  Effect.gen(function*() {
    const isTool = (n: string): n is Extract<keyof Tools, string> => Object.hasOwn(toolkit.tools, n)
    if (!isTool(name)) return yield* fail(`no tool ${name}; \`pnpm driver tools\` lists them`)
    const handlers = yield* toolkit
    const results = yield* handlers.handle(
      name,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unchecked on purpose: handle decodes them with the tool's own schema
      params as Tool.ParametersEncoded<Tools[typeof name]>
    )
    const last = yield* Stream.runLast(Stream.filter(results, (r) => !r.preliminary))
    return Option.match(last, { onNone: () => null, onSome: (r) => r.encodedResult })
  }).pipe(Effect.mapError(toDriverError))
