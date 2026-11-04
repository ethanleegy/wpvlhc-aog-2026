import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig(({ command }) => ({
  worker: { format: "es" },
  base: command === "serve" ? "/" : "/assets/gallery/",
  build: { outDir: "../assets/gallery", emptyOutDir: true, rollupOptions: { input: resolve(import.meta.dirname, "src/guest.js"), output: { entryFileNames: "guest.js", assetFileNames: "[name][extname]" } } },
  server: { fs: { allow: [resolve(import.meta.dirname, "..")], deny: ["**/.env*", "**/*.env", "**/*.{crt,pem}", "**/.git/**", "**/.gallery-local/**", "**/.dev.vars*", "**/.secret.*", "**/.aws/**"] } },
}));
