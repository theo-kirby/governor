import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// GOVERNOR_BASE=/gov/ builds for serving under a path prefix (a proxy that strips it).
export default defineConfig({
  base: process.env.GOVERNOR_BASE || "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4311" },
  },
});
