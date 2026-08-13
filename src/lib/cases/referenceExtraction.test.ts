import { describe, expect, it } from "vitest";
import { extractReferences, extractReferencesFromThread } from "./referenceExtraction";
import type { NormalizedThread } from "@/lib/gmail/types";

describe("extractReferences", () => {
  it("extrae cotizaciones tipo Odoo (S00103)", () => {
    const refs = extractReferences("Asunto: Re: Cotización S00103 para el cliente");
    expect(refs).toContainEqual({ type: "QUOTE", value: "S00103", matchedText: "S00103" });
  });

  it("extrae OC con distintos separadores y normaliza al mismo valor", () => {
    const withSpace = extractReferences("OC 40991 pendiente de aprobacion");
    const withNSign = extractReferences("Adjunto la OC N° 40991 firmada");
    const withDash = extractReferences("Ref: OC-40991");
    expect(withSpace[0]).toEqual({ type: "PURCHASE_ORDER", value: "OC40991", matchedText: "OC 40991" });
    expect(withNSign[0]?.value).toBe("OC40991");
    expect(withDash[0]?.value).toBe("OC40991");
  });

  it("extrae PO con el mismo patron", () => {
    const refs = extractReferences("PO-55210 confirmada por el proveedor");
    expect(refs).toContainEqual({ type: "PURCHASE_ORDER", value: "PO55210", matchedText: "PO-55210" });
  });

  it("extrae RFQ", () => {
    const refs = extractReferences("Solicitud RFQ-4821 enviada al proveedor");
    expect(refs).toContainEqual({ type: "RFQ", value: "RFQ4821", matchedText: "RFQ-4821" });
  });

  it("extrae codigos de proyecto tipo MDZ", () => {
    const refs = extractReferences("Proyecto MDZ5256 - avance de obra");
    expect(refs).toContainEqual({ type: "PROJECT", value: "MDZ5256", matchedText: "MDZ5256" });
  });

  it("extrae pedidos tipo PI-xx/xxx", () => {
    const refs = extractReferences("Pedido PI-26/136 despachado hoy");
    expect(refs).toContainEqual({ type: "PROJECT", value: "PI-26/136", matchedText: "PI-26/136" });
  });

  it("extrae ordenes de venta tipo SO", () => {
    const refs = extractReferences("SO-12345 lista para facturar");
    expect(refs).toContainEqual({ type: "SALES_ORDER", value: "SO12345", matchedText: "SO-12345" });
  });

  it("no encuentra nada en texto sin referencias — devuelve array vacio, nunca inventa", () => {
    expect(extractReferences("Hola, como estas? Nos vemos mañana.")).toEqual([]);
  });

  it("deduplica la misma referencia si aparece varias veces en el texto", () => {
    const refs = extractReferences("S00103 ... más adelante vuelve a aparecer S00103 otra vez");
    expect(refs.filter((r) => r.value === "S00103")).toHaveLength(1);
  });

  it("extrae varias referencias distintas del mismo texto, en orden de prioridad de patrones", () => {
    const refs = extractReferences("Sobre la cotización S00103 y la OC 40991 asociada");
    expect(refs.map((r) => r.value)).toEqual(["S00103", "OC40991"]);
  });

  it("agregar un patron nuevo no rompe los existentes (extensibilidad) — ejemplo: los patrones actuales no interfieren entre si", () => {
    const refs = extractReferences("RFQ-99 / PO-100 / SO-200 / MDZ999 / S09999 / PI-1/26");
    const types = refs.map((r) => r.type);
    expect(types).toEqual(["QUOTE", "PURCHASE_ORDER", "RFQ", "PROJECT", "PROJECT", "SALES_ORDER"]);
  });
});

describe("extractReferencesFromThread", () => {
  function thread(overrides: Partial<NormalizedThread> = {}): NormalizedThread {
    return {
      threadId: "t-1",
      historyId: "h1",
      subject: "Consulta general",
      webUrl: "https://mail.google.com/mail/u/0/#inbox/t-1",
      messages: [
        {
          id: "m1",
          direction: "INBOUND",
          from: "cliente@ejemplo.com",
          fromName: "Cliente",
          to: ["me@tmc.com"],
          cc: [],
          subject: "Consulta general",
          date: "2026-08-01T00:00:00.000Z",
          snippet: "",
          bodyText: "Buen dia, les escribo por la OC 40991 que enviamos la semana pasada.",
          hasListUnsubscribe: false,
        },
      ],
      ...overrides,
    };
  }

  it("busca en subject Y en el cuerpo — no solo en el subject (item 15: el subject puede cambiar)", () => {
    const refs = extractReferencesFromThread(thread());
    expect(refs).toContainEqual({ type: "PURCHASE_ORDER", value: "OC40991", matchedText: "OC 40991" });
  });

  it("busca en TODOS los mensajes del thread, no solo el primero", () => {
    const t = thread({
      subject: "Re: Consulta",
      messages: [
        { id: "m1", direction: "INBOUND", from: "a@x.com", fromName: null, to: [], cc: [], subject: "Consulta", date: "2026-08-01T00:00:00.000Z", snippet: "", bodyText: "hola", hasListUnsubscribe: false },
        { id: "m2", direction: "OUTBOUND", from: "me@tmc.com", fromName: "Felipe", to: ["a@x.com"], cc: [], subject: "Re: Consulta", date: "2026-08-02T00:00:00.000Z", snippet: "", bodyText: "Te confirmo la cotizacion S00296", hasListUnsubscribe: false },
      ],
    });
    const refs = extractReferencesFromThread(t);
    expect(refs).toContainEqual({ type: "QUOTE", value: "S00296", matchedText: "S00296" });
  });
});
