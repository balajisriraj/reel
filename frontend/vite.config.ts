import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Two pages: the studio, and the bare film page the renderer screenshots frame by frame.
export default defineConfig({
  plugins: [react()],
  server: { port: 5190, proxy: { "/api": "http://127.0.0.1:8070" } },
  build: {
    rollupOptions: { input: { studio: resolve(__dirname, "index.html"), render: resolve(__dirname, "render.html") } },
  },
  test: { environment: "node" },
});
