import { describe, expect, it } from "vitest";
import { normalizeSummary } from "./textNormalize";

describe("normalizeSummary", () => {
  it("un summary de 120 caracteres queda sin cambios", () => {
    const s = "a".repeat(120);
    expect(normalizeSummary(s)).toBe(s);
    expect(normalizeSummary(s).length).toBe(120);
  });

  it("un summary de exactamente 200 caracteres queda sin cambios", () => {
    const s = "a".repeat(200);
    expect(normalizeSummary(s)).toBe(s);
    expect(normalizeSummary(s).length).toBe(200);
  });

  it("un summary de 201 caracteres se normaliza a <=200", () => {
    const s = "a".repeat(201);
    const result = normalizeSummary(s);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("un summary de 400 caracteres se normaliza a <=200", () => {
    const s = "a".repeat(400);
    const result = normalizeSummary(s);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("corta en limite de palabra cuando es razonable, no a mitad de una palabra", () => {
    const words = Array.from({ length: 40 }, (_, i) => `palabra${i}`);
    const s = words.join(" "); // bien por encima de 200 chars, con espacios frecuentes
    const result = normalizeSummary(s);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith(" ")).toBe(false);
    // no corta a mitad de una palabra: el resultado completo debe ser un prefijo valido
    // de palabras completas del original.
    expect(s.startsWith(result)).toBe(true);
    expect(s[result.length]).toBe(" ");
  });

  it("una 'palabra' unica sin espacios de mas de 200 caracteres corta duro sin lanzar error", () => {
    const s = "a".repeat(500);
    expect(() => normalizeSummary(s)).not.toThrow();
    expect(normalizeSummary(s).length).toBeLessThanOrEqual(200);
  });

  it("colapsa whitespace excesivo (tabs, saltos de linea, espacios repetidos)", () => {
    const s = "Hola   mundo\n\ncon\ttabs   y   espacios";
    expect(normalizeSummary(s)).toBe("Hola mundo con tabs y espacios");
  });

  it("hace trim de espacios al principio y al final", () => {
    expect(normalizeSummary("   hola mundo   ")).toBe("hola mundo");
  });

  it("nunca lanza error solo por longitud, para ningun tamaño de input", () => {
    for (const len of [0, 1, 199, 200, 201, 199_999]) {
      expect(() => normalizeSummary("x".repeat(len))).not.toThrow();
    }
  });
});
