import { describe, expect, it } from "vitest";
import { resolveDatePhrase } from "./resolveDatePhrase";

// Referencia fija: lunes 10 de agosto de 2026 (mismo dia usado en los wireframes del spec).
const REF = "2026-08-10";

describe("resolveDatePhrase", () => {
  it("resuelve hoy / manana / pasado manana", () => {
    expect(resolveDatePhrase("hoy", REF)).toBe("2026-08-10");
    expect(resolveDatePhrase("manana", REF)).toBe("2026-08-11");
    expect(resolveDatePhrase("pasado manana", REF)).toBe("2026-08-12");
  });

  it("resuelve dias de la semana a la proxima ocurrencia", () => {
    expect(resolveDatePhrase("miercoles", REF)).toBe("2026-08-12");
    expect(resolveDatePhrase("el miercoles", REF)).toBe("2026-08-12");
    expect(resolveDatePhrase("viernes", REF)).toBe("2026-08-14");
    expect(resolveDatePhrase("domingo", REF)).toBe("2026-08-16");
  });

  it("un dia de semana igual al de hoy se resuelve a la semana siguiente", () => {
    // REF es lunes -> pedir "lunes" no puede significar hoy
    expect(resolveDatePhrase("lunes", REF)).toBe("2026-08-17");
    expect(resolveDatePhrase("proximo lunes", REF)).toBe("2026-08-17");
  });

  it("interpreta prefijos de deadline (antes de/para)", () => {
    expect(resolveDatePhrase("antes del viernes", REF)).toBe("2026-08-14");
    expect(resolveDatePhrase("antes de fin de mes", REF)).toBe("2026-08-31");
    expect(resolveDatePhrase("para el jueves", REF)).toBe("2026-08-13");
  });

  it("resuelve la semana que viene a proximo lunes", () => {
    expect(resolveDatePhrase("la semana que viene", REF)).toBe("2026-08-17");
    expect(resolveDatePhrase("semana que viene", REF)).toBe("2026-08-17");
  });

  it("resuelve fin de mes y fin de semana", () => {
    expect(resolveDatePhrase("fin de mes", REF)).toBe("2026-08-31");
    expect(resolveDatePhrase("fin de semana", REF)).toBe("2026-08-15");
  });

  it("resuelve fechas explicitas", () => {
    expect(resolveDatePhrase("12 de agosto", REF)).toBe("2026-08-12");
    expect(resolveDatePhrase("20 de agosto de 2026", REF)).toBe("2026-08-20");
    expect(resolveDatePhrase("15/08", REF)).toBe("2026-08-15");
    // fecha ya pasada este anio sin anio explicito -> asume el proximo anio
    expect(resolveDatePhrase("1 de enero", REF)).toBe("2027-01-01");
  });

  it("devuelve null para frases no reconocidas o vacias", () => {
    expect(resolveDatePhrase("cuando pueda", REF)).toBeNull();
    expect(resolveDatePhrase("", REF)).toBeNull();
    expect(resolveDatePhrase(null, REF)).toBeNull();
    expect(resolveDatePhrase(undefined, REF)).toBeNull();
  });

  it("es insensible a mayusculas/acentos", () => {
    expect(resolveDatePhrase("MIÉRCOLES", REF)).toBe("2026-08-12");
    expect(resolveDatePhrase("Miércoles", REF)).toBe("2026-08-12");
  });
});
