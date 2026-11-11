// A vitest setup file: importing `electron` fails the test file at once. The real package downloads its ~100 MB
// binary the first time Node loads it, and parallel workers race to unpack it into the same folder. Tests provide
// their own layers for the services in src/electron/; only the layers in src/electron/live/ call Electron.
// A test file that really needs Electron opts out with `vi.unmock("electron")`.
import { vi } from "vitest"

vi.mock("electron", () => {
  throw new Error(
    "tests must not load electron; provide a layer for the service instead (src/electron/live/ holds the real ones)"
  )
})
