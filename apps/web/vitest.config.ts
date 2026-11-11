import { defineConfig } from "vitest/config"
import { sharedTest } from "../../.config/vitest"

export default defineConfig({
  test: {
    ...sharedTest,
    include: ["src/**/*.test.ts", "build/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000
  }
})
