"use client";

import { useState } from "react";

interface ConversationState {
  conversation: { id: string; title: string; status: string; template_id: string | null } | null;
  messages: Array<{ id: string; role: string; content_redacted: string; created_at: string }>;
  specs: Array<{ id: string; version_number: number; spec_json: Record<string, unknown>; spec_hash: string }>;
  generationRuns: Array<{ id: string; status: string; bundle_storage_path: string | null; error_sanitized: string | null }>;
  versionLinks: Array<{ id: string; change_summary: string | null; template_version?: { id: string; status: string; build_status: string } }>;
}

const EMPTY_STATE: ConversationState = {
  conversation: null,
  messages: [],
  specs: [],
  generationRuns: [],
  versionLinks: [],
};

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export function BundleAgentClient() {
  const [state, setState] = useState<ConversationState>(EMPTY_STATE);
  const [title, setTitle] = useState("Nuevo bundle Remotion");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(conversationId = state.conversation?.id) {
    if (!conversationId) return;
    const payload = await readJson(await fetch(`/api/admin/remotion/bundle-agent/conversations/${conversationId}`, { cache: "no-store" }));
    setState({
      conversation: payload.conversation,
      messages: payload.messages || [],
      specs: payload.specs || [],
      generationRuns: payload.generationRuns || [],
      versionLinks: payload.versionLinks || [],
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header>
        <p className="text-sm font-medium text-slate-500">Produccion visual</p>
        <h1 className="text-3xl font-semibold text-slate-950">SofLIA Bundle Agent</h1>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="grid gap-3 rounded-md border border-slate-200 p-4">
        <label className="text-sm font-medium text-slate-700" htmlFor="conversation-title">
          Conversacion
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="conversation-title"
            className="min-h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <button
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const payload = await readJson(await fetch("/api/admin/remotion/bundle-agent/conversations", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ title }),
                }));
                await refresh(payload.conversation.id);
              })
            }
          >
            Crear conversacion
          </button>
        </div>
        {state.conversation ? (
          <p className="text-sm text-slate-600">
            Estado: <span className="font-medium">{state.conversation.status}</span>
            {state.conversation.template_id ? ` · Template: ${state.conversation.template_id}` : ""}
          </p>
        ) : null}
      </section>

      <section className="grid gap-3 rounded-md border border-slate-200 p-4">
        <textarea
          className="min-h-32 rounded-md border border-slate-300 p-3 text-sm"
          placeholder="Describe el estilo, componentes visuales, props esperadas y comportamiento del template."
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
            disabled={busy || !state.conversation || !message.trim()}
            onClick={() =>
              run(async () => {
                await readJson(await fetch(`/api/admin/remotion/bundle-agent/conversations/${state.conversation!.id}/messages`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ role: "USER", content: message }),
                }));
                setMessage("");
                await refresh();
              })
            }
          >
            Enviar mensaje
          </button>
          <button
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
            disabled={busy || !state.conversation}
            onClick={() => run(async () => {
              await readJson(await fetch(`/api/admin/remotion/bundle-agent/conversations/${state.conversation!.id}/specs`, { method: "POST" }));
              await refresh();
            })}
          >
            Generar spec
          </button>
          <button
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy || !state.conversation || state.specs.length === 0}
            onClick={() => run(async () => {
              await readJson(await fetch(`/api/admin/remotion/bundle-agent/conversations/${state.conversation!.id}/generate`, { method: "POST" }));
              await refresh();
            })}
          >
            Generar version ZIP
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-slate-200 p-4">
          <h2 className="mb-3 text-lg font-semibold">Historial</h2>
          <div className="grid gap-2">
            {state.messages.map((item) => (
              <div key={item.id} className="rounded-md bg-slate-50 p-3 text-sm">
                <p className="font-medium">{item.role}</p>
                <p className="whitespace-pre-wrap text-slate-700">{item.content_redacted}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-slate-200 p-4">
          <h2 className="mb-3 text-lg font-semibold">Versiones</h2>
          <div className="grid gap-2 text-sm">
            {state.specs[0] ? (
              <pre className="max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-white">
                {JSON.stringify(state.specs[0].spec_json, null, 2)}
              </pre>
            ) : null}
            {state.generationRuns.map((run) => (
              <div key={run.id} className="rounded-md bg-slate-50 p-3">
                <p className="font-medium">{run.status}</p>
                <p className="break-all text-slate-600">{run.bundle_storage_path || run.error_sanitized}</p>
              </div>
            ))}
            {state.versionLinks.map((link) => (
              <div key={link.id} className="rounded-md border border-slate-200 p-3">
                <p className="font-medium">Version: {link.template_version?.status || "registrada"}</p>
                <p className="text-slate-600">Build: {link.template_version?.build_status || "PENDING"}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
