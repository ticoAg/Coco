import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    strictPort: true,
    port: 5173,
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-dom") || id.includes("react")) return "react-vendor";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("react-markdown")) return "markdown";
          if (id.includes("@tauri-apps")) return "tauri";
          return "vendor";
        },
      },
    },
  },
});
