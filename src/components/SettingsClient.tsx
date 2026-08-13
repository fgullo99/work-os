"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CompanyRow, ContactRow, ContactTier, ContextRow } from "@/lib/supabase/types";
import { AppShell } from "./AppShell";
import { GmailConnectPanel } from "./GmailConnectPanel";
import { GmailCatchupPanel } from "./GmailCatchupPanel";
import { CaseCatchupPanel } from "./CaseCatchupPanel";
import { WhatsAppStatusPanel } from "./WhatsAppStatusPanel";
import { CalendarStatusPanel } from "./CalendarStatusPanel";
import { AiEnginePanel } from "./AiEnginePanel";
import { AiAutomationPanel } from "./AiAutomationPanel";
import { PurgeDemoPanel } from "./PurgeDemoPanel";

interface Props {
  companies: CompanyRow[];
  contacts: ContactRow[];
  contexts: ContextRow[];
  userFirstName: string;
  gmailConnected: boolean;
  gmailEmail: string | null;
  aiProvider: string;
  aiModel: string;
}

export function SettingsClient({
  companies,
  contacts,
  contexts,
  userFirstName,
  gmailConnected,
  gmailEmail,
  aiProvider,
  aiModel,
}: Props) {
  const router = useRouter();

  async function createEntity(endpoint: string, body: Record<string, unknown>) {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    router.refresh();
  }

  async function deleteEntity(endpoint: string) {
    await fetch(endpoint, { method: "DELETE" });
    router.refresh();
  }

  return (
    <AppShell userFirstName={userFirstName} gmailConnected={gmailConnected} gmailEmail={gmailEmail}>
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Settings</h1>
          <p className="mt-1 text-sm text-ink-500">Integraciones y datos base usados por el dashboard.</p>
        </div>

        <div id="integrations">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Integrations</p>
          <div className="space-y-4">
            <GmailConnectPanel />
            <CaseCatchupPanel />
            <GmailCatchupPanel />
            <WhatsAppStatusPanel />
            <CalendarStatusPanel />
          </div>
        </div>

        <AiAutomationPanel />

        <AiEnginePanel provider={aiProvider} model={aiModel} />

        <PurgeDemoPanel />

        <div id="companies">
          <CompanySection companies={companies} onCreate={createEntity} onDelete={deleteEntity} />
        </div>
        <div id="contacts">
          <ContactSection contacts={contacts} companies={companies} onCreate={createEntity} onDelete={deleteEntity} />
        </div>
        <div id="contexts">
          <ContextSection contexts={contexts} companies={companies} onCreate={createEntity} onDelete={deleteEntity} />
        </div>
      </div>
    </AppShell>
  );
}

function CompanySection({
  companies,
  onCreate,
  onDelete,
}: {
  companies: CompanyRow[];
  onCreate: (endpoint: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (endpoint: string) => Promise<void>;
}) {
  const [name, setName] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreate("/api/companies", { name: name.trim() });
    setName("");
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink-800">Companies</h2>
      <ul className="mt-3 divide-y divide-ink-100">
        {companies.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm text-ink-700">
            {c.name}
            <button type="button" onClick={() => onDelete(`/api/companies/${c.id}`)} className="btn-ghost">
              Eliminar
            </button>
          </li>
        ))}
        {companies.length === 0 && <li className="py-2 text-sm text-ink-400">Sin companies todavia.</li>}
      </ul>
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de empresa" className="input" />
        <button type="submit" className="btn-primary">
          Agregar
        </button>
      </form>
    </section>
  );
}

function ContactSection({
  contacts,
  companies,
  onCreate,
  onDelete,
}: {
  contacts: ContactRow[];
  companies: CompanyRow[];
  onCreate: (endpoint: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (endpoint: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [tier, setTier] = useState<ContactTier>("B");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreate("/api/contacts", {
      name: name.trim(),
      email: email.trim() || null,
      phone_e164: phone.trim() || null,
      company_id: companyId || null,
      tier,
    });
    setName("");
    setEmail("");
    setPhone("");
    setCompanyId("");
    setTier("B");
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink-800">Contacts</h2>
      <ul className="mt-3 divide-y divide-ink-100">
        {contacts.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm text-ink-700">
            <span>
              {c.name} <span className="text-xs text-ink-400">(Tier {c.tier})</span>
            </span>
            <button type="button" onClick={() => onDelete(`/api/contacts/${c.id}`)} className="btn-ghost">
              Eliminar
            </button>
          </li>
        ))}
        {contacts.length === 0 && <li className="py-2 text-sm text-ink-400">Sin contacts todavia.</li>}
      </ul>
      <form onSubmit={handleSubmit} className="mt-3 grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" className="input" />
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="input">
          <option value="">Sin empresa</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (opcional)" className="input" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefono (opcional)" className="input" />
        <select value={tier} onChange={(e) => setTier(e.target.value as ContactTier)} className="input">
          <option value="A">Tier A</option>
          <option value="B">Tier B</option>
          <option value="C">Tier C</option>
        </select>
        <button type="submit" className="btn-primary">
          Agregar
        </button>
      </form>
    </section>
  );
}

function ContextSection({
  contexts,
  companies,
  onCreate,
  onDelete,
}: {
  contexts: ContextRow[];
  companies: CompanyRow[];
  onCreate: (endpoint: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (endpoint: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await onCreate("/api/contexts", { title: title.trim(), company_id: companyId || null });
    setTitle("");
    setCompanyId("");
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink-800">Contexts</h2>
      <ul className="mt-3 divide-y divide-ink-100">
        {contexts.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm text-ink-700">
            {c.title}
            <button type="button" onClick={() => onDelete(`/api/contexts/${c.id}`)} className="btn-ghost">
              Eliminar
            </button>
          </li>
        ))}
        {contexts.length === 0 && <li className="py-2 text-sm text-ink-400">Sin contexts todavia.</li>}
      </ul>
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Cliente ABC - Trafo 1600 kVA" className="input" />
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="input w-40">
          <option value="">Sin empresa</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary">
          Agregar
        </button>
      </form>
    </section>
  );
}
