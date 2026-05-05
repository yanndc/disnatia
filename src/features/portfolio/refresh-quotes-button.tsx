"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { RefreshLiveQuotesResult } from "./refresh-live-quotes";

type RefreshState =
  | { status: "idle" }
  | { status: "success"; result: RefreshLiveQuotesResult; durationMs: number }
  | { status: "error"; message: string; durationMs: number };

function formatDuration(durationMs: number) {
  return durationMs < 1_000
    ? `${durationMs} ms`
    : `${(durationMs / 1_000).toLocaleString("fr-CA", { maximumFractionDigits: 1 })} s`;
}

export function RefreshQuotesButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [refreshState, setRefreshState] = useState<RefreshState>({ status: "idle" });

  async function onRefresh() {
    setPending(true);
    const startedAt = performance.now();
    try {
      const response = await fetch("/api/portfolio/refresh-quotes", {
        method: "POST",
      });
      const durationMs = Math.round(performance.now() - startedAt);
      const payload = (await response.json().catch(() => null)) as RefreshLiveQuotesResult | null;

      if (response.ok) {
        if (payload) {
          setRefreshState({ status: "success", result: payload, durationMs });
        }
        router.refresh();
        return;
      }

      setRefreshState({
        status: "error",
        message: payload?.message ?? "Échec du rafraîchissement des cours.",
        durationMs,
      });
    } catch (cause) {
      setRefreshState({
        status: "error",
        message: cause instanceof Error ? cause.message : "Échec du rafraîchissement des cours.",
        durationMs: Math.round(performance.now() - startedAt),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2 sm:text-right">
      <Button
        type="button"
        variant="secondary"
        className="h-9 px-3 text-sm"
        disabled={pending}
        onClick={() => void onRefresh()}
      >
        {pending ? "Mise à jour…" : "Actualiser les cours"}
      </Button>
      {pending ? (
        <p className="text-xs text-slate-500">Appel Yahoo en cours…</p>
      ) : null}
      {refreshState.status === "success" ? (
        <p className="max-w-sm text-xs leading-relaxed text-slate-500">
          Dernier test OK en {formatDuration(refreshState.durationMs)} ·{" "}
          {refreshState.result.quotesUpserted}/{refreshState.result.positionsConsidered} cours mis à
          jour
          {refreshState.result.quotesMissing > 0
            ? ` · ${refreshState.result.quotesMissing} manquant(s)`
            : ""}{" "}
          · {refreshState.result.yahooSymbolsRequested} symboles Yahoo ·{" "}
          {new Date(refreshState.result.fetchedAt).toLocaleString("fr-CA")}
          {refreshState.result.missingYahooSymbols.length > 0
            ? ` · non retournés : ${refreshState.result.missingYahooSymbols.join(", ")}`
            : ""}
          {refreshState.result.message ? ` · ${refreshState.result.message}` : ""}
        </p>
      ) : null}
      {refreshState.status === "error" ? (
        <p className="max-w-sm text-xs leading-relaxed text-red-600">
          Échec après {formatDuration(refreshState.durationMs)} · {refreshState.message}
        </p>
      ) : null}
    </div>
  );
}
