import { defineConfig } from "vitest/config"
import { sharedTest } from "../../.config/vitest.ts"

export default defineConfig({
  test: {
    ...sharedTest
  }
})
