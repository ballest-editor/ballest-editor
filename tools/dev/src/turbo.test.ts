import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { gitCommonDir } from "./git.ts"
import { linkTurboCache, sharedTurboCache, withConcurrency } from "./turbo.ts"

describe("sharedTurboCache", () => {
  it("points every worktree at one cache under git's common dir", () => {
    expect(sharedTurboCache({})).toEqual({ TURBO_CACHE_DIR: `${gitCommonDir()}/turbo-cache` })
  })

  it.each([{ CI: "1" }, { TURBO_CACHE_DIR: "/elsewhere" }])("leaves turbo's own setting with %o", (env) => {
    expect(sharedTurboCache(env)).toEqual({})
  })
})

describe("withConcurrency", () => {
  it.each([
    [["typecheck"], ["typecheck", "--concurrency=4"]],
    [["test", "--", "--changed=abc"], ["test", "--concurrency=4", "--", "--changed=abc"]],
    [["build", "--concurrency=2"], ["build", "--concurrency=2"]],
    [["build", "--concurrency", "2"], ["build", "--concurrency", "2"]],
    // A --concurrency after `--` belongs to the task, not to turbo.
    [["test", "--", "--concurrency=9"], ["test", "--concurrency=4", "--", "--concurrency=9"]]
  ])("%o becomes %o", (args, expected) => {
    expect(withConcurrency(args, 4)).toEqual(expected)
  })
})

describe("linkTurboCache", () => {
  const dirs: Array<string> = []
  const scratch = () => {
    const dir = mkdtempSync(join(tmpdir(), "link-turbo-cache-"))
    dirs.push(dir)
    return { root: join(dir, "worktree"), shared: join(dir, "common", "turbo-cache") }
  }
  const local = (root: string) => join(root, "node_modules", ".cache", "turbo")
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  it("links a worktree with no cache yet to the shared one", () => {
    const { root, shared } = scratch()
    linkTurboCache({}, root, shared)
    expect(lstatSync(local(root)).isSymbolicLink()).toBe(true)
    expect(readlinkSync(local(root))).toBe(shared)
  })

  it("moves what a worktree's own cache held into the shared one", () => {
    const { root, shared } = scratch()
    mkdirSync(local(root), { recursive: true })
    writeFileSync(join(local(root), "abc.tar.zst"), "entry")
    linkTurboCache({}, root, shared)
    expect(readlinkSync(local(root))).toBe(shared)
    expect(readFileSync(join(shared, "abc.tar.zst"), "utf8")).toBe("entry")
  })

  it("repoints a link to somewhere else", () => {
    const { root, shared } = scratch()
    mkdirSync(join(root, "node_modules", ".cache"), { recursive: true })
    symlinkSync(join(root, "elsewhere"), local(root))
    linkTurboCache({}, root, shared)
    expect(readlinkSync(local(root))).toBe(shared)
  })

  it.each([{ CI: "1" }, { TURBO_CACHE_DIR: "/elsewhere" }])("leaves the cache alone with %o", (env) => {
    const { root, shared } = scratch()
    linkTurboCache(env, root, shared)
    expect(() => lstatSync(local(root))).toThrow("ENOENT")
  })
})
