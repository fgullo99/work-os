"use client";

import { useState } from "react";
import { addDaysISO } from "@/lib/dates/calendarMath";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  title: string;
  todayISO: string;
  onClose: () => void;
  onConfirm: (dateISO: string) => void;
}

export function DatePickerModal({ open, title, todayISO, onClose, onConfirm }: Props) {
  const [date, setDate] = useState(todayISO);

  return (
    <Modal open={open} onClose={onClose} widthClass="max-w-sm">
      <div className="p-6">
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button type="button" className="btn-secondary" onClick={() => onConfirm(addDaysISO(todayISO, 1))}>
            Manana
          </button>
          <button type="button" className="btn-secondary" onClick={() => onConfirm(addDaysISO(todayISO, 2))}>
            2 dias
          </button>
          <button type="button" className="btn-secondary" onClick={() => onConfirm(addDaysISO(todayISO, 7))}>
            Prox. semana
          </button>
        </div>
        <div className="mt-4">
          <label className="label">O elegi una fecha</label>
          <div className="flex gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
            <button type="button" className="btn-primary" onClick={() => onConfirm(date)}>
              OK
            </button>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}
