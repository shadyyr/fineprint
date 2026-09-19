import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Match tsconfig's "@/*" paths so tests can import modules that use them.
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
