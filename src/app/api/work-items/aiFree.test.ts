import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Regresion: editar/gestionar un Work Item (Done/Postpone/Delegate/Received/Extend/Note/
 * Reopen/Ignore/Update) nunca debe llamar a un AIProvider — la IA solo corre en el pipeline
 * de ingestion (Gmail sync, Zapia webhook, Capture), nunca bloqueando la edicion de un item
 * ya existente. Test estatico (lee el codigo fuente) en vez de mockear el runtime completo:
 * si alguien agrega un import de @/lib/ai a una de estas rutas, esto falla explicitamente.
 */
function findRouteFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findRouteFiles(full));
    } else if (entry === "route.ts") {
      results.push(full);
    }
  }
  return results;
}

const ROOT = path.join(process.cwd(), "src", "app", "api", "work-items");
const routeFiles = findRouteFiles(ROOT);

describe("api/work-items routes nunca importan IA", () => {
  it("encuentra al menos las rutas esperadas (sanity check)", () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(9);
  });

  it.each(routeFiles)("%s no importa @/lib/ai ni el SDK de Anthropic", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/from ["']@\/lib\/ai/);
    expect(source).not.toMatch(/@anthropic-ai/);
    expect(source).not.toMatch(/AIProvider/);
  });
});
