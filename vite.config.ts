import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Never watch Rust build output: on Windows the freshly linked exe
    // is locked, which crashes the dev server with EBUSY. Tauri CLI
    // already watches src-tauri itself for rebuilds.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM ? "chrome105" : "esnext",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
