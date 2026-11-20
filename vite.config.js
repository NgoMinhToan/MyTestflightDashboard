import { defineConfig } from "vite";

// Relative base keeps the built site working from any GitHub Pages project
// path (https://<owner>.github.io/<repo>/) without rewriting asset URLs.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
