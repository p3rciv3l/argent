import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared")
    }
  }
});
