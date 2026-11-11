import { defineConfig } from "vitest/config"
import { sharedTest } from "../../.config/vitest.ts"

export default defineConfig({
  test: {
    ...sharedTest,
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    setupFiles: ["src/test/noElectron.ts"]
  }
})
