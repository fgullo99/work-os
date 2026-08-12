import { afterEach, describe, expect, it, vi } from "vitest";
import { runOptimisticListAction } from "./optimisticListAction";

interface Item {
  id: string;
  title: string;
}

function makeItems(): Item[] {
  return [
    { id: "a", title: "Item A" },
    { id: "b", title: "Item B" },
    { id: "c", title: "Item C" },
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runOptimisticListAction", () => {
  it("saca el item de la lista inmediatamente, antes de esperar la respuesta del servidor", async () => {
    const items = makeItems();
    let current = items;
    const setList = vi.fn((updater: (items: Item[]) => Item[]) => {
      current = updater(current);
    });
    let resolveFetch: (v: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve)))
    );

    const promise = runOptimisticListAction({
      id: "b",
      path: "done",
      currentList: items,
      setList,
      onError: vi.fn(),
    });

    // Sin esperar el fetch, la card ya desaparecio de la lista local.
    expect(current.map((i) => i.id)).toEqual(["a", "c"]);

    resolveFetch(new Response(null, { status: 200 }));
    await promise;
  });

  it("fetch exitoso (200): no hace rollback ni llama a onError", async () => {
    const items = makeItems();
    let current = items;
    const setList = (updater: (items: Item[]) => Item[]) => {
      current = updater(current);
    };
    const onError = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    await runOptimisticListAction({ id: "b", path: "done", currentList: items, setList, onError });

    expect(current.map((i) => i.id)).toEqual(["a", "c"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("fetch con status de error (ej. 500): hace rollback a la posicion original y llama a onError", async () => {
    const items = makeItems();
    let current = items;
    const setList = (updater: (items: Item[]) => Item[]) => {
      current = updater(current);
    };
    const onError = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runOptimisticListAction({ id: "b", path: "done", currentList: items, setList, onError });

    expect(current.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(onError).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it("fetch que rechaza (error de red): mismo rollback que un status de error", async () => {
    const items = makeItems();
    let current = items;
    const setList = (updater: (items: Item[]) => Item[]) => {
      current = updater(current);
    };
    const onError = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runOptimisticListAction({ id: "a", path: "done", currentList: items, setList, onError });

    expect(current.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(onError).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it("el rollback restaura el item en su indice original, no al final de la lista", async () => {
    const items = makeItems(); // a, b, c — "b" esta en el indice 1
    let current = items;
    const setList = (updater: (items: Item[]) => Item[]) => {
      current = updater(current);
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runOptimisticListAction({ id: "b", path: "postpone", currentList: items, setList, onError: vi.fn() });

    expect(current.map((i) => i.id)).toEqual(["a", "b", "c"]);
    consoleSpy.mockRestore();
  });

  it("un id que no esta en la lista no dispara ningun cambio de estado, pero igual hace el POST", async () => {
    const items = makeItems();
    const setList = vi.fn();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runOptimisticListAction({ id: "z", path: "done", currentList: items, setList, onError: vi.fn() });

    expect(setList).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/work-items/z/done", expect.objectContaining({ method: "POST" }));
  });

  it("con body, manda Content-Type y el JSON serializado; sin body, no manda headers/body", async () => {
    const items = makeItems();
    const setList = () => {};
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runOptimisticListAction({
      id: "a",
      path: "delegate",
      currentList: items,
      setList,
      body: { responsible_id: "u-1" },
      onError: vi.fn(),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/work-items/a/delegate",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responsible_id: "u-1" }),
      })
    );

    fetchMock.mockClear();
    await runOptimisticListAction({ id: "a", path: "done", currentList: items, setList, onError: vi.fn() });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/work-items/a/done",
      expect.objectContaining({ method: "POST", headers: undefined, body: undefined })
    );
  });
});
