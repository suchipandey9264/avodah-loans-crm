import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    // Forward /api calls to the backend during development (see ../backend). CRM_API_PROXY overrides the target.
    proxy: { "/api": process.env.CRM_API_PROXY ?? "http://localhost:4000" },
  },
});
