// apps/web's domain code imports without extensions, as Vite resolves them. Node doesn't, so this adds `.ts` to a
// relative import that names no file of its own. `node --import` loads it before main.ts.
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"

registerHooks({
  resolve: (specifier, context, nextResolve) => {
    const relative = specifier.startsWith("./") || specifier.startsWith("../")
    if (relative && context.parentURL?.startsWith("file:") === true && !/\.[a-z]+$/i.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
    }
    return nextResolve(specifier, context)
  }
})
