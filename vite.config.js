import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist-renderer",
    rollupOptions: {
      input: "src/renderer/index.html",
    },
  },
  server: {
    port: 3000,
  },
});
