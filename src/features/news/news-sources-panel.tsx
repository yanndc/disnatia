"use client";

import { useState } from "react";
import { ExternalLink, FlaskConical, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { NEWS_CATEGORY_LABELS } from "@/features/news/news-categories";
import { formatRelativeTimeFr } from "@/features/news/relative-time";
import type { NewsSourceRow } from "@/features/news/queries";

type TestResult = {
  ok: boolean;
  itemCount: number;
  feedTitle?: string;
  entries: { title: string; url: string }[];
  error?: string;
};

/** Panneau admin : consultation, activation, pondération et test des flux de nouvelles. */
export function NewsSourcesPanel({ initialSources }: { initialSources: NewsSourceRow[] }) {
  const [sources, setSources] = useState(initialSources);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ sourceId: string; result: TestResult } | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [creating, setCreating] = useState(false);

  async function reload() {
    const res = await fetch("/api/news/sources", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { sources?: NewsSourceRow[] };
    if (data.sources) setSources(data.sources);
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/news/sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(data.error ?? "Modification impossible.");
        return;
      }
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/news/sources/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(data.error ?? "Suppression impossible.");
        return;
      }
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function test(id: string) {
    setBusyId(id);
    setTestResult(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/news/sources/${id}/test`, { method: "POST" });
      const result = (await res.json()) as TestResult;
      setTestResult({ sourceId: id, result });
    } catch {
      setMessage("Test impossible.");
    } finally {
      setBusyId(null);
    }
  }

  async function create() {
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/news/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), feedUrl: newUrl.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage(data.error ?? "Ajout impossible.");
        return;
      }
      setNewName("");
      setNewUrl("");
      setMessage("Flux ajouté.");
      await reload();
    } finally {
      setCreating(false);
    }
  }

  async function refreshNow() {
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/news/refresh", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        itemsCreated?: number;
        sourcesOk?: number;
        sourcesFailed?: number;
        error?: string;
      };
      setMessage(
        res.ok
          ? `${data.itemsCreated ?? 0} article(s) ajouté(s) · ${data.sourcesOk ?? 0} flux OK · ${
              data.sourcesFailed ?? 0
            } en erreur`
          : (data.error ?? "Rafraîchissement impossible."),
      );
      await reload();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Sources du fil de nouvelles</CardTitle>
          <Button
            variant="secondary"
            onClick={() => void refreshNow()}
            disabled={refreshing}
            className="h-9 gap-1.5 px-3 text-xs"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Ingérer maintenant
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {message ? <p className="text-xs text-slate-700">{message}</p> : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="pb-2">Flux</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Santé</th>
                  <th className="pb-2">7 j</th>
                  <th className="pb-2">Poids</th>
                  <th className="pb-2">Actif</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sources.map((source) => (
                  <tr key={source.id} className="align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-900">{source.name}</div>
                      <div className="mt-0.5 max-w-[26rem] truncate font-mono text-[10px] text-slate-400">
                        {source.feedUrl}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {NEWS_CATEGORY_LABELS[source.category]} · {source.language.toUpperCase()}
                        {source.isSeed ? " · registre" : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-slate-600">
                      {source.kind === "AUTO_TICKER" ? "Auto (titres)" : "RSS"}
                    </td>
                    <td className="py-2 pr-3">
                      {source.lastStatus === "ERROR" ? (
                        <span
                          className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 ring-1 ring-rose-200"
                          title={source.lastError ?? undefined}
                        >
                          Erreur
                        </span>
                      ) : source.lastStatus === "OK" ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                          OK
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">jamais lu</span>
                      )}
                      <div className="mt-1 text-[10px] text-slate-400">
                        {source.lastFetchedAt ? formatRelativeTimeFr(source.lastFetchedAt) : "—"}
                      </div>
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-slate-700">{source.itemCount7d}</td>
                    <td className="py-2 pr-3">
                      <input
                        key={`weight-${source.id}-${source.weight}`}
                        type="number"
                        min={0.2}
                        max={2}
                        step={0.1}
                        defaultValue={source.weight}
                        disabled={busyId === source.id}
                        onBlur={(event) => {
                          const next = Number(event.target.value);
                          if (!Number.isFinite(next) || next === source.weight) return;
                          void patch(source.id, { weight: Math.min(2, Math.max(0.2, next)) });
                        }}
                        className="h-8 w-16 rounded-md border border-slate-200 px-2 text-xs tabular-nums"
                        aria-label={`Poids de ${source.name}`}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Switch
                        checked={source.isActive}
                        disabled={busyId === source.id}
                        onCheckedChange={(next) => void patch(source.id, { isActive: next })}
                        aria-label={`Activer ${source.name}`}
                      />
                    </td>
                    <td className="py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void test(source.id)}
                          disabled={busyId === source.id}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                        >
                          {busyId === source.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <FlaskConical className="size-3" />
                          )}
                          Tester
                        </button>
                        {source.homepageUrl ? (
                          <a
                            href={source.homepageUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                            aria-label="Ouvrir le site"
                          >
                            <ExternalLink className="size-3" />
                          </a>
                        ) : null}
                        {!source.isSeed ? (
                          <button
                            type="button"
                            onClick={() => void remove(source.id)}
                            disabled={busyId === source.id}
                            className="rounded-md p-1 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                            aria-label={`Supprimer ${source.name}`}
                          >
                            <Trash2 className="size-3" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>


          {testResult ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              {testResult.result.ok ? (
                <>
                  <p className="font-medium text-slate-800">
                    {testResult.result.feedTitle ?? "Flux lisible"} ·{" "}
                    {testResult.result.itemCount} entrée(s)
                  </p>
                  <ul className="mt-1 space-y-0.5 text-slate-600">
                    {testResult.result.entries.map((entry) => (
                      <li key={entry.url} className="truncate">
                        • {entry.title}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-rose-700">Échec : {testResult.result.error}</p>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <div className="min-w-[12rem] flex-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Nom du flux
              </label>
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Ex. Finance et Investissement"
                className="h-9 text-xs"
              />
            </div>
            <div className="min-w-[16rem] flex-[2]">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                URL RSS / Atom
              </label>
              <Input
                value={newUrl}
                onChange={(event) => setNewUrl(event.target.value)}
                placeholder="https://exemple.com/feed/"
                className="h-9 text-xs"
              />
            </div>
            <Button
              onClick={() => void create()}
              disabled={creating || newName.trim().length < 2 || !newUrl.trim()}
              className="h-9 gap-1.5 px-3 text-xs"
            >
              {creating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Ajouter
            </Button>
          </div>

          <p className="text-[11px] text-slate-400">
            Les flux « registre » viennent du code (seed) : ils ne peuvent pas être supprimés, mais
            peuvent être désactivés ou repondérés. « Ingérer maintenant » lance la même tâche que le
            cron.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}


