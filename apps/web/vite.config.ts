import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localCacheRecovery } from "./dev/local-cache-recovery.ts";
import { pdfWorker } from "./dev/pdf-worker.ts";

export default defineConfig({
  server: {
    port: 3001,
    strictPort: true,
  },
  resolve: {
    tsconfigPaths: true,
  },
  ssr: {
    // PDFKit resolves private font modules relative to its own package.
    external: ["@react-pdf/renderer"],
  },
  plugins: [
    localCacheRecovery(),
    pdfWorker(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
