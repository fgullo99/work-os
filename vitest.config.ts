import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // El resto del repo son tests de logica pura/data-layer (environment: "node", ver la
  // mayoria de los *.test.ts). Los componentes React usan un docblock
  // "// @vitest-environment jsdom" por archivo para pedir DOM solo donde hace falta, sin
  // pagar el costo de jsdom en el resto de la suite.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
  },
});
