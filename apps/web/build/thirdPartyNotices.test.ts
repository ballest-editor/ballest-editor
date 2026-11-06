import { assert, describe, it } from "@effect/vitest"
import * as path from "node:path"
import { noticesOf, readThirdPartyNotices } from "./thirdPartyNotices"

const repoRoot = path.resolve(import.meta.dirname, "../../..")

describe("third-party notices", () => {
  it("lists each package once, by name, with the first licence text found", () => {
    const notices = noticesOf(
      {
        ISC: [{ name: "zed", versions: ["2.0.0"], paths: ["/zed"], license: "ISC" }],
        MIT: [
          {
            name: "alpha",
            versions: ["1.0.0", "1.1.0"],
            paths: ["/alpha-1.0.0", "/alpha-1.1.0"],
            license: "MIT",
            author: "A",
            homepage: "https://example.com"
          },
          { name: "@ballest/web", versions: ["0.0.0"], paths: ["/web"], license: "MIT" },
          { name: "@types/three", versions: ["0.1.0"], paths: ["/types"], license: "MIT" }
        ]
      },
      (dir) => dir === "/alpha-1.1.0" ? "The text" : null
    )
    assert.deepStrictEqual(notices, [
      {
        name: "alpha",
        version: "1.0.0, 1.1.0",
        license: "MIT",
        author: "A",
        homepage: "https://example.com",
        text: "The text"
      },
      { name: "zed", version: "2.0.0", license: "ISC", author: null, homepage: null, text: null }
    ])
  })

  it("covers what ships from the real lockfile, and leaves out what only builds it", () => {
    const notices = readThirdPartyNotices(repoRoot)
    const names = new Set(notices.map((notice) => notice.name))
    for (const name of ["effect", "react", "three", "@base-ui/react", "electron-updater", "electron"]) {
      assert.isTrue(names.has(name), `${name} is listed`)
    }
    for (const name of ["vitest", "typescript", "shadcn", "@ballest/web"]) {
      assert.isFalse(names.has(name), `${name} isn't listed`)
    }
    assert.match(notices.find((notice) => notice.name === "react")?.text ?? "", /Permission is hereby granted/)
  })
})
