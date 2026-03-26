import path from "node:path";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

// Merge Vite env loading from project root (.env, .env.local, .env.[mode], etc.) into process.env
// so modules like supabaseClient see keys during test imports.
Object.assign(process.env, loadEnv(process.env.NODE_ENV || "test", process.cwd(), ""));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/task-intake-parity.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
      "server-only": path.resolve(process.cwd(), "src/__tests__/shims/server-only.ts"),
    },
  },
});
