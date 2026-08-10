"use client";

import { useEffect, useState } from "react";
import { formatDateLongEs } from "@/lib/format/date";
import { MetricCard } from "./MetricCard";

interface Props {
  userFirstName: string;
  todayISO: string;
  counts: { today: number; atRisk: number; waiting: number; review: number };
}

export function DashboardHeader({ userFirstName, todayISO, counts }: Props) {
  const [greeting, setGreeting] = useState("Hola");

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting("Buenos dias");
    else if (hour < 19) setGreeting("Buenas tardes");
    else setGreeting("Buenas noches");
  }, []);

  return (
    <header className="mb-6">
      <p className="text-sm capitalize text-ink-500">{formatDateLongEs(todayISO)}</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink-900">
        {greeting}, {userFirstName}
      </h1>
      <p className="mt-1 text-sm text-ink-500">Tu centro de atencion y seguimiento.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Prioridades" value={counts.today} tone="accent" />
        <MetricCard label="En riesgo" value={counts.atRisk} tone="risk" />
        <MetricCard label="Esperando" value={counts.waiting} tone="waiting" />
        <MetricCard label="Review" value={counts.review} tone="neutral" />
      </div>
    </header>
  );
}
