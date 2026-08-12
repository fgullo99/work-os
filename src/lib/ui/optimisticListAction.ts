export interface OptimisticListActionParams<T extends { id: string }> {
  id: string;
  path: string;
  currentList: T[];
  setList: (updater: (items: T[]) => T[]) => void;
  body?: Record<string, unknown>;
  onError: () => void;
}

/**
 * Optimistic update sobre una lista puntual del Dashboard (Today/Waiting): saca el item de
 * la lista antes de esperar la respuesta del servidor, dispara el POST, y si falla lo vuelve
 * a poner en su posicion original + notifica el error via onError (el caller decide como
 * mostrarlo — normalmente un toast). No hace router.refresh(): pensado para acciones que no
 * cambian que otros items existen (Done/Postpone/Delegate/Received), no para Review. Extraida
 * de DashboardClient.tsx para poder testearla sin montar el arbol de componentes completo —
 * ver optimisticListAction.test.ts.
 */
export async function runOptimisticListAction<T extends { id: string }>(params: OptimisticListActionParams<T>): Promise<void> {
  const { id, path, currentList, setList, body, onError } = params;

  const index = currentList.findIndex((i) => i.id === id);
  const removedItem = index !== -1 ? currentList[index] : undefined;
  if (removedItem) {
    setList((items) => items.filter((i) => i.id !== id));
  }

  try {
    const res = await fetch(`/api/work-items/${id}/${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    console.error(`[dashboard] accion ${path} sobre ${id} fallo:`, err);
    if (removedItem) {
      const itemToRestore = removedItem;
      const restoreIndex = index;
      setList((items) => {
        const next = [...items];
        next.splice(Math.min(restoreIndex, next.length), 0, itemToRestore);
        return next;
      });
    }
    onError();
  }
}
