"use client";

import { useState } from "react";
import type { ContactRow } from "@/lib/supabase/types";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  contacts: ContactRow[];
  todayISO: string;
  onClose: () => void;
  onConfirm: (responsibleId: string, expectedDateISO: string) => void;
}

export function DelegateModal({ open, contacts, todayISO, onClose, onConfirm }: Props) {
  const [responsibleId, setResponsibleId] = useState("");
  const [expectedDate, setExpectedDate] = useState(todayISO);

  return (
    <Modal open={open} onClose={onClose} widthClass="max-w-sm">
      <div className="p-6">
        <h2 className="text-base font-semibold text-ink-900">Delegate</h2>
        <div className="mt-4">
          <label className="label">Persona responsable</label>
          <select value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)} className="input">
            <option value="">Elegir...</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3">
          <label className="label">Fecha esperada</label>
          <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="input" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!responsibleId}
            onClick={() => responsibleId && onConfirm(responsibleId, expectedDate)}
          >
            Delegar
          </button>
        </div>
      </div>
    </Modal>
  );
}
