import { defineConfig } from "vitest/config"
import { sharedTest } from "../../.config/vitest.ts"

export default defineConfig({
  test: {
    ...sharedTest,
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000
  }
})
