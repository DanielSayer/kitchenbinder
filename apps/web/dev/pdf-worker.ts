import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "vite";

const workerEntry = fileURLToPath(
  new URL("../../../packages/api/src/recipes/pdf-worker.ts", import.meta.url),
);
const developmentDirectory = fileURLToPath(
  new URL("../node_modules/.cache/pdf-worker/", import.meta.url),
);

// Emit a separate Node entry so worker termination actually stops rendering.
// Vite processes the fonts/logo identically to the SSR build.
export function pdfWorker(): Plugin {
  let developmentBuild: Promise<unknown> | undefined;
  return {
    name: "prep-sheet-pdf-worker",
    resolveId(id) {
      if (id === "virtual:pdf-worker") return "\0virtual:pdf-worker";
    },
    async load(id) {
      if (id !== "\0virtual:pdf-worker") return;
      if (this.environment.mode === "build") {
        const reference = this.emitFile({
          type: "chunk",
          id: workerEntry,
          fileName: "pdf-worker.js",
        });
        return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
      }
      // The development module runner cannot execute inside a Node worker.
      // Build the same entry once; restart dev after changing the PDF template.
      developmentBuild ??= build({
        configFile: false,
        publicDir: false,
        logLevel: "warn",
        ssr: { external: ["@react-pdf/renderer"] },
        build: {
          ssr: workerEntry,
          outDir: developmentDirectory,
          emptyOutDir: true,
          rollupOptions: { output: { entryFileNames: "pdf-worker.js" } },
        },
      });
      await developmentBuild;
      return `export default ${JSON.stringify(pathToFileURL(`${developmentDirectory}/pdf-worker.js`).href)};`;
    },
    resolveFileUrl: {
      // Vite's asset hook otherwise turns this Node worker into a public URL.
      order: "pre",
      handler({ fileName, relativePath }) {
        if (fileName !== "pdf-worker.js") return;
        return `new URL(${JSON.stringify(relativePath)}, import.meta.url).href`;
      },
    },
  };
}
