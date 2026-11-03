import { describe, expect, it } from "vitest"
import { gameArgs, VERSION_OVERRIDE, withVersionOverride } from "./prefix.ts"

const reg = `WINE REGISTRY Version 2
;; All keys relative to \\\\User\\\\S-1-5-21-0-0-0-1000

[Software\\\\Wine\\\\DllOverrides] 1790839217
#time=1dd51754f11c3c2
"api-ms-win-crt-conio-l1-1-0"="native,builtin"
"atiadlxx"="disabled"

[Software\\\\Wine\\\\Fonts] 1790839217
#time=1dd51754f11c3c3
"Codepages"="1252,437"
`

describe("withVersionOverride", () => {
  it("adds the override under the existing DllOverrides key, after its time line", () => {
    const out = withVersionOverride(reg)
    const lines = out.split("\n")
    const at = lines.indexOf("#time=1dd51754f11c3c2")
    expect(lines[at + 1]).toBe(VERSION_OVERRIDE)
    expect(lines[at + 2]).toBe(`"api-ms-win-crt-conio-l1-1-0"="native,builtin"`)
    expect(out).toContain(`[Software\\\\Wine\\\\Fonts]`)
  })

  it("leaves a prefix that has it alone", () => {
    const once = withVersionOverride(reg)
    expect(withVersionOverride(once)).toBe(once)
  })

  it("adds the key when the prefix has none", () => {
    const out = withVersionOverride(
      "WINE REGISTRY Version 2\n\n[Software\\\\Wine\\\\Fonts] 1\n#time=1\n\"Codepages\"=\"1252\"\n"
    )
    expect(out).toMatch(/\n\[Software\\\\Wine\\\\DllOverrides\] \d+\n#time=[0-9a-f]+\n"version"="native,builtin"\n$/)
  })
})

describe("gameArgs", () => {
  it("renders offscreen headless and in a 720p window otherwise, always lite and in its own user dir", () => {
    expect(gameArgs("headless")).toEqual(["-RenderOffscreen", "-d3d11", "-nosound", "-userdir=C:\\slot\\UserDir"])
    expect(gameArgs("window")).toEqual([
      "-windowed",
      "-ResX=1280",
      "-ResY=720",
      "-d3d11",
      "-nosound",
      "-userdir=C:\\slot\\UserDir"
    ])
  })
})
