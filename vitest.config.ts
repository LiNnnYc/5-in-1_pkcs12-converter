import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: resolve(__dirname),
    include: ["src/**/__tests__/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src/renderer"),
      "@types": resolve(__dirname, "src/types")
    }
  }
});
