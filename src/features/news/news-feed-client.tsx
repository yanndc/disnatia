"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NEWS_CATEGORY_LABELS } from "@/features/news/news-categories";
import { NewsCard } from "@/features/news/news-card";
import type { NewsFeedItem, NewsFeedScope } from "@/features/news/queries";
import type { NewsCategory } from "@/generated/prisma/client";

type SourceOption = { slug: string; name: string };

const SCOPE_TABS: { id: NewsFeedScope; label: string }[] = [
  { id: "portfolio", label: "Mes titres" },
  { id: "all", label: "Tout" },
  { id: "saved", label: "Sauvegardées" },
];

const CATEGORY_OPTIONS = Object.entries(NEWS_CATEGORY_LABELS) as Array<[NewsCategory, string]>;

export function NewsFeedClient({
  initialItems,
  initialCursor,
  initialTotal,
  initialSource,
  sources,
}: {
  initialItems: NewsFeedItem[];
  initialCursor: string | null;
  initialTotal: number;
  initialSource: string;
  sources: SourceOption[];
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [total, setTotal] = useState(initialTotal);
  const [scope, setScope] = useState<NewsFeedScope>("portfolio");
  const [category, setCategory] = useState<NewsCategory | "">("");
  const [sourceSlug, setSourceSlug] = useState(initialSource);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const skipInitialLoadRef = useRef(true);

  const buildQuery = useCallback(
    (nextCursor: string | null) => {
      const params = new URLSearchParams({ scope });
      if (category) params.set("category", category);
      if (sourceSlug) params.set("source", sourceSlug);
      if (query.trim().length >= 2) params.set("q", query.trim());
      if (nextCursor) params.set("cursor", nextCursor);
      return params.toString();
    },
    [scope, category, sourceSlug, query],
  );

  const load = useCallback(
    async (mode: "reset" | "more") => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (mode === "reset") setLoading(true);
      try {
        const res = await fetch(
          `/api/news?${buildQuery(mode === "more" ? cursor : null)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Fil indisponible");
        const data = (await res.json()) as {
          items: NewsFeedItem[];
          nextCursor: string | null;
          totalMatched: number;
        };
        if (requestId !== requestIdRef.current) return;
        setItems((prev) => (mode === "more" ? [...prev, ...data.items] : data.items));
        setCursor(data.nextCursor);
        setTotal(data.totalMatched);
      } catch {
        if (requestId === requestIdRef.current) setMessage("Impossible de charger le fil.");
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [buildQuery, cursor],
  );

  useEffect(() => {
    // La première page vient du rendu serveur : on ne refait pas l'appel au montage.
    if (skipInitialLoadRef.current) {
      skipInitialLoadRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void load("reset");
    }, 250);
    return () => window.clearTimeout(timer);
    // Rechargement uniquement quand les filtres changent (pas au changement de curseur).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, category, sourceSlug, query]);

  const toggleState = useCallback(async (item: NewsFeedItem, patch: { read?: boolean; saved?: boolean }) => {
    setSavingId(item.id);
    try {
      const res = await fetch(`/api/news/${item.id}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return;
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                read: patch.read ?? row.read,
                saved: patch.saved ?? row.saved,
              }
            : row,
        ),
      );
      if (patch.saved === false) {
        setItems((prev) => prev.filter((row) => !(scope === "saved" && row.id === item.id)));
      }
    } finally {
      setSavingId(null);
    }
  }, [scope]);

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
      if (!res.ok) {
        setMessage(data.error ?? "Rafraîchissement impossible.");
        return;
      }
      setMessage(
        `${data.itemsCreated ?? 0} nouvelle(s) ajoutée(s) · ${
          data.sourcesOk ?? 0
        } flux OK · ${data.sourcesFailed ?? 0} en erreur`,
      );
      await load("reset");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {SCOPE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScope(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                scope === tab.id
                  ? "bg-slate-950 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <select
          value={category}
          onChange={(event) => setCategory(event.target.value as NewsCategory | "")}
          className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
          aria-label="Catégorie"
        >
          <option value="">Toutes catégories</option>
          {CATEGORY_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={sourceSlug}
          onChange={(event) => setSourceSlug(event.target.value)}
          className="h-9 max-w-[14rem] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
          aria-label="Source"
        >
          <option value="">Toutes les sources</option>
          {sources.map((source) => (
            <option key={source.slug} value={source.slug}>
              {source.name}
            </option>
          ))}
        </select>

        <div className="min-w-[12rem] flex-1">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un titre, une société, un mot-clé…"
            className="h-9 text-xs"
            aria-label="Rechercher dans les nouvelles"
          />
        </div>

        <Button
          variant="secondary"
          onClick={() => void refreshNow()}
          disabled={refreshing}
          className="h-9 gap-1.5 px-3 text-xs"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Rafraîchir
        </Button>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {loading ? "Chargement…" : `${total} nouvelle(s) dans cette vue`}
          {scope === "portfolio" ? " · triées par impact portefeuille" : ""}
        </span>
        {message ? <span className="text-slate-700">{message}</span> : null}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Chargement du fil…
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-900">Aucune nouvelle dans cette vue</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            {scope === "portfolio"
              ? "Les articles sont rattachés aux titres détenus. Lance un rafraîchissement ou élargis la vue à « Tout »."
              : "Essaie un autre filtre ou lance un rafraîchissement."}
          </p>
        </div>
      ) : null}

      <div className="space-y-2.5">
        {items.map((item) => (
          <NewsCard
            key={item.id}
            item={item}
            saving={savingId === item.id}
            onOpen={(row) => {
              if (!row.read) void toggleState(row, { read: true });
            }}
            onToggleSave={(row) => void toggleState(row, { saved: !row.saved })}
          />
        ))}
      </div>

      {cursor ? (
        <div className="flex justify-center pt-2">
          <Button
            variant="secondary"
            onClick={() => void load("more")}
            disabled={loading}
            className="gap-1.5 text-xs"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Charger plus
          </Button>
        </div>
      ) : null}
    </div>
  );
}
