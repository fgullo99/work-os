import { describe, expect, it } from "vitest";
import { titleSimilarity } from "./workItemMatch";

describe("titleSimilarity", () => {
  it("titulos identicos dan similaridad maxima", () => {
    expect(titleSimilarity("Cliente ABC - Trafo 1600 kVA", "Cliente ABC - Trafo 1600 kVA")).toBe(1);
  });

  it("titulos con overlap parcial fuerte dan similaridad alta", () => {
    // comparten "cliente", "trafo", "1600" (>=4 caracteres) de un lado con menos palabras
    const sim = titleSimilarity("Cliente ABC - Trafo 1600 kVA", "Trafo 1600 - seguimiento");
    expect(sim).toBeGreaterThanOrEqual(0.5);
  });

  it("titulos sin relacion dan similaridad baja", () => {
    const sim = titleSimilarity("Cliente ABC - Trafo 1600 kVA", "Proveedor XYZ - Factura pendiente");
    expect(sim).toBeLessThan(0.5);
  });

  it("es insensible a mayusculas y acentos", () => {
    expect(titleSimilarity("Revisión de planos", "revision de PLANOS")).toBe(1);
  });

  it("titulo vacio da similaridad 0", () => {
    expect(titleSimilarity("", "Cliente ABC")).toBe(0);
  });
});
