//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"

export default [
  ...tanstackConfig,
  {
    rules: {
      "import/no-cycle": "off",
      "import/order": "off",
      "import/consistent-type-specifier-style": "off",
      "sort-imports": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/require-await": "off",
      "pnpm/json-enforce-catalog": "off",
      // Effect idioms: service interfaces use method signatures, type params are A/E/R/S.
      "@typescript-eslint/method-signature-style": "off",
      "@typescript-eslint/naming-convention": "off",
    },
  },
  {
    ignores: ["eslint.config.js", ".prettierrc", "dist/**", "src/routeTree.gen.ts"],
  },
]
