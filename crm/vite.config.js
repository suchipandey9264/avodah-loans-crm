import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    // Forward /api calls to the backend during development (see ../backend). CRM_API_PROXY overrides the target.
    // Lender logos live in the public site (frontend/public/bank-logos); CRM_SITE_PROXY overrides where it runs.
    proxy: { "/api": process.env.CRM_API_PROXY ?? "http://localhost:4000", "/bank-logos": process.env.CRM_SITE_PROXY ?? "http://localhost:5173" },
  },
});
