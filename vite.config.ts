import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [vue()],
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src/renderer"),
      "@types": resolve(__dirname, "src/types")
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true
  }
});

