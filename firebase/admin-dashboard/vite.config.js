import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    worker: { format: "es" },
    plugins: [react()],
    server: {
      fs: { allow: [resolve(import.meta.dirname, "../..")], deny: ["**/.env*", "**/*.env", "**/*.{crt,pem}", "**/.git/**", "**/.gallery-local/**", "**/.dev.vars*", "**/.secret.*", "**/.aws/**"] },
      port: 5173,
      strictPort: true,
      proxy: {
        "/v1": {
          target:
            process.env.API_PROXY_TARGET ||
            env.API_PROXY_TARGET ||
            "http://127.0.0.1:5001/demo-wpvlhc/us-central1/api",
          changeOrigin: true,
        },
      },
    },
  };
});
