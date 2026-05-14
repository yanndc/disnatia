"use client";

import { DisnatiaLogo } from "@/components/brand/disnatia-logo";
import { safeInternalPath } from "@/lib/site-access";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

function SiteLockForm() {
  const searchParams = useSearchParams();
  const fromRaw = searchParams.get("from");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/site-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          redirect: safeInternalPath(fromRaw),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        redirect?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? "Échec de la connexion.");
        return;
      }
      window.location.href = data?.redirect ?? "/overview";
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6 py-16 text-white">
      <DisnatiaLogo className="mb-8 h-10 w-auto text-white" />
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-slate-950/50">
        <h1 className="text-xl font-semibold tracking-tight">Accès DisnatIA</h1>
        <p className="mt-2 text-sm text-slate-400">
          Entre le mot de passe pour continuer.
        </p>
        <form className="mt-8 space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-medium text-slate-200">
            Mot de passe
            <input
              type="password"
              autoComplete="current-password"
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none ring-cyan-400/40 placeholder:text-slate-500 focus:ring-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? (
            <p className="text-sm text-rose-300" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="flex h-11 w-full items-center justify-center rounded-xl bg-white text-sm font-semibold text-slate-950 transition hover:bg-cyan-50 disabled:opacity-60"
          >
            {pending ? "Vérification…" : "Continuer"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function SiteLockPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
          Chargement…
        </main>
      }
    >
      <SiteLockForm />
    </Suspense>
  );
}
