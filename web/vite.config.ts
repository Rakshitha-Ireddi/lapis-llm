import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// `base: "./"` keeps every asset URL relative, so the same build works at
// https://<user>.github.io/<repo>/, on a custom domain, and when the master
// serves it from `/`.
export default defineConfig({
  base: process.env.LAPIS_BASE ?? "./",
  server: {
    port: 5173,
    proxy: {
      // `npm run dev` + `lapis demo` → the console can talk to the live master.
      "/api": "http://127.0.0.1:8080",
      "/v1": "http://127.0.0.1:8080",
      "/healthz": "http://127.0.0.1:8080",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        console: resolve(__dirname, "console.html"),
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
