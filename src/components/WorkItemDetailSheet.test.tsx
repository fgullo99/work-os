// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkItemDetailSheet } from "./WorkItemDetailSheet";
import { ToastProvider } from "./Toast";
import type { WorkItemWithRelations } from "@/lib/workItems/types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function makeWorkItem(overrides: Partial<WorkItemWithRelations> = {}): WorkItemWithRelations {
  return {
    id: "wi-1",
    title: "Cotizacion 13.2kV",
    context_id: null,
    company_id: null,
    contact_id: null,
    category: null,
    status: "OPEN",
    responsible_id: null,
    next_action: null,
    waiting_for_what: null,
    waiting_for_contact_id: null,
    due_date: null,
    expected_date: null,
    committed_date: null,
    follow_up_date: null,
    postponed_until: null,
    blocking: false,
    blocking_note: null,
    estimated_minutes: null,
    last_activity_at: "2026-08-01T00:00:00.000Z",
    ai_summary: null,
    ai_confidence: null,
    last_message_direction: null,
    is_demo: false,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    last_reconciled_at: null,
    last_reconciled_thread_version: null,
    case_id: null,
    company: null,
    context: null,
    contact: null,
    waiting_for_contact: null,
    responsible: null,
    ...overrides,
  };
}

function stubFetchSequence(workItem: WorkItemWithRelations) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!init && url === `/api/work-items/${workItem.id}`) {
      return new Response(JSON.stringify({ ok: true, workItem, sources: [], notes: [], aiActions: [] }), { status: 200 });
    }
    if (init?.method === "PATCH") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("WorkItemDetailSheet — autosave debounce", () => {
  it("un campo de texto (title) NO dispara el PATCH inmediatamente, espera el debounce de 700ms", async () => {
    const workItem = makeWorkItem();
    const fetchMock = stubFetchSequence(workItem);

    render(
      <ToastProvider>
        <WorkItemDetailSheet workItemId="wi-1" onClose={() => {}} companies={[]} contacts={[]} contexts={[]} todayISO="2026-08-12" />
      </ToastProvider>
    );

    const titleInput = await screen.findByDisplayValue("Cotizacion 13.2kV");
    expect(fetchMock).toHaveBeenCalledTimes(1); // solo el GET inicial

    vi.useFakeTimers();
    fireEvent.change(titleInput, { target: { value: "Cotizacion 13.2kV (revisar)" } });

    // El estado local ya cambio (input controlado), pero todavia no se disparo el PATCH.
    expect(screen.getByDisplayValue("Cotizacion 13.2kV (revisar)")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(699);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/work-items/wi-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ title: "Cotizacion 13.2kV (revisar)" }) })
    );
  });

  it("varios cambios seguidos dentro de la ventana de debounce colapsan en un solo PATCH, con el ultimo valor", async () => {
    const workItem = makeWorkItem({ next_action: null });
    const fetchMock = stubFetchSequence(workItem);

    render(
      <ToastProvider>
        <WorkItemDetailSheet workItemId="wi-1" onClose={() => {}} companies={[]} contacts={[]} contexts={[]} todayISO="2026-08-12" />
      </ToastProvider>
    );

    const actionInput = await screen.findByPlaceholderText("Sin accion");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    fireEvent.change(actionInput, { target: { value: "Mandar" } });
    await vi.advanceTimersByTimeAsync(300);
    fireEvent.change(actionInput, { target: { value: "Mandar cotiza" } });
    await vi.advanceTimersByTimeAsync(300);
    fireEvent.change(actionInput, { target: { value: "Mandar cotizacion final" } });

    // Cada tecleo reinicia el timer — a los 600ms del ultimo cambio todavia no se guardo.
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/work-items/wi-1",
      expect.objectContaining({ body: JSON.stringify({ next_action: "Mandar cotizacion final" }) })
    );
  });

  it("un campo select (Responsible) guarda inmediatamente, sin esperar el debounce", async () => {
    const workItem = makeWorkItem();
    const fetchMock = stubFetchSequence(workItem);

    render(
      <ToastProvider>
        <WorkItemDetailSheet
          workItemId="wi-1"
          onClose={() => {}}
          companies={[]}
          contacts={[{ id: "c-1", name: "Nicolas", tier: "A" } as any]}
          contexts={[]}
          todayISO="2026-08-12"
        />
      </ToastProvider>
    );

    const responsibleSelect = await screen.findByDisplayValue("Sin asignar (vos)");
    vi.useFakeTimers();
    fireEvent.change(responsibleSelect, { target: { value: "c-1" } });

    // Sin avanzar el reloj: un campo no-debounced ya deberia haber disparado el PATCH.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/work-items/wi-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ responsible_id: "c-1" }) })
    );
  });
});
