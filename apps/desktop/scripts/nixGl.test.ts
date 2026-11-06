import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { nixGlEnv } from "./nixGl"

describe("nixGlEnv", () => {
  let withEgl: string
  let withoutEgl: string
  const build = vi.fn<() => string>(() => "/nix/store/x-libglvnd")

  beforeEach(() => {
    build.mockClear()
    withEgl = fs.mkdtempSync(path.join(os.tmpdir(), "nix-gl-"))
    withoutEgl = fs.mkdtempSync(path.join(os.tmpdir(), "nix-gl-"))
    fs.writeFileSync(path.join(withEgl, "libEGL.so.1"), "")
  })

  afterEach(() => {
    fs.rmSync(withEgl, { recursive: true })
    fs.rmSync(withoutEgl, { recursive: true })
  })

  it("adds libglvnd when nix-ld's libraries have no libEGL.so.1", () => {
    expect(nixGlEnv({ NIX_LD_LIBRARY_PATH: withoutEgl }, build)).toEqual({
      LD_LIBRARY_PATH: "/nix/store/x-libglvnd/lib"
    })
  })

  it("keeps an existing library path behind libglvnd", () => {
    expect(nixGlEnv({ LD_LIBRARY_PATH: withoutEgl }, build)).toEqual({
      LD_LIBRARY_PATH: `/nix/store/x-libglvnd/lib:${withoutEgl}`
    })
  })

  it("builds nothing when the system already has libEGL.so.1", () => {
    expect(nixGlEnv({ NIX_LD_LIBRARY_PATH: `${withoutEgl}:${withEgl}` }, build)).toEqual({})
    expect(nixGlEnv({ LD_LIBRARY_PATH: withEgl }, build)).toEqual({})
    expect(build).not.toHaveBeenCalled()
  })

  it("warns and starts Electron anyway when the build fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const failing = () => {
      throw new Error("nix: command not found")
    }
    expect(nixGlEnv({}, failing)).toEqual({})
    expect(warn.mock.calls[0]?.[0]).toContain("nix: command not found")
    warn.mockRestore()
  })
})
