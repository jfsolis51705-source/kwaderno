import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API runs on :8100 (see backend/). Both dev and preview proxy /api and /media to it.
const target = process.env.API_URL ?? "http://127.0.0.1:8100";
// /s/... are the share links (preview tags for social apps); the API serves them too.
const proxy = { "/api": { target, changeOrigin: true, xfwd: true }, "/media": { target, changeOrigin: true }, "/s/": { target, changeOrigin: true, xfwd: true } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
