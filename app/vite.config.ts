import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The repo-level .env (NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, NEO4J_DATABASE) is the single source of config.
// NEO4J_ is exposed to the browser bundle on purpose: this is a local demo, never deploy it publicly.
export default defineConfig({
  plugins: [react()],
  envDir: "..",
  envPrefix: ["VITE_", "NEO4J_"],
  server: { port: 5173 },
});
