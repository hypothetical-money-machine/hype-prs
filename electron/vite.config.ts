import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const rendererRoot = fileURLToPath(new URL("./renderer", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(
      new URL("../dist-electron/renderer", import.meta.url),
    ),
    sourcemap: false,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  root: rendererRoot,
});
