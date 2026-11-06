import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { nextAnswer } from "./ScriptedDialogs"

describe("nextAnswer", () => {
  it("takes answers in order, and cancels when none is left", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dialogs-")), "dialogs.json")
    fs.writeFileSync(file, JSON.stringify([{ path: "/a" }, { button: 1 }]))
    expect(nextAnswer(file)).toEqual({ path: "/a" })
    expect(nextAnswer(file)).toEqual({ button: 1 })
    expect(nextAnswer(file)).toEqual({})
  })
})
