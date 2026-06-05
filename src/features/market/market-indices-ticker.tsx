"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { signedGainClass } from "@/features/portfolio/performance-indicator-logic";
import { quoteAgeFromFetchedAt } from "@/lib/market/quote-age";
import type { MarketIndexQuote, MarketIndicesPayload } from "@/lib/market/market-indices";
import { formatNumber, formatPercent } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const STALE_AFTER_MS = 60_000;

function formatIndexPrice(quote: MarketIndexQuote): string {
  if (quote.price === null) return "—";
  if (quote.kind === "forex") {
    return formatNumber(quote.price, 4);
  }
  return formatNumber(quote.price, quote.price >= 10_000 ? 0 : 2);
}

function formatChangeAmount(quote: MarketIndexQuote): string {
  if (quote.changeAmount === null) return "—";
  const prefix = quote.changeAmount > 0 ? "+" : "";
  if (quote.kind === "forex") {
    return `${prefix}${formatNumber(quote.changeAmount, 4)}`;
  }
  return `${prefix}${formatNumber(quote.changeAmount, 2)}`;
}

function TickerItem({ quote }: { quote: MarketIndexQuote }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 px-5 text-sm">
      <span className="font-semibold text-white">{quote.label}</span>
      <span className="tabular-nums text-slate-200">{formatIndexPrice(quote)}</span>
      <span className={`tabular-nums ${signedGainClass(quote.changeAmount)}`}>
        {formatChangeAmount(quote)}
      </span>
      <span className={`tabular-nums ${signedGainClass(quote.changePct)}`}>
        {quote.changePct === null ? "—" : formatPercent(quote.changePct)}
      </span>
    </span>
  );
}

export function MarketIndicesTicker() {
  const [payload, setPayload] = useState<MarketIndicesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastFetchMsRef = useRef(0);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (inFlightRef.current) return;
    const now = Date.now();
    if (!force && now - lastFetchMsRef.current < STALE_AFTER_MS) return;

    inFlightRef.current = true;
    try {
      const res = await fetch("/api/market/indices", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as MarketIndicesPayload;
      if (data.ok) {
        setPayload(data);
        lastFetchMsRef.current = Date.now();
      }
    } catch {
      /* prochain cycle */
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);

    const refreshTimer = window.setInterval(() => void refresh(true), REFRESH_INTERVAL_MS);
    const clockTimer = window.setInterval(() => setNowMs(Date.now()), 60_000);

    function onVisibility() {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const quoteAge = useMemo(
    () => quoteAgeFromFetchedAt(payload?.fetchedAt ?? null, nowMs),
    [payload?.fetchedAt, nowMs],
  );

  const quotes = payload?.quotes ?? [];
  const hasQuotes = quotes.some((q) => q.price !== null);

  if (!loading && !hasQuotes) return null;

  const track = [...quotes, ...quotes];

  return (
    <section
      className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 shadow-sm"
      aria-label="Indicateurs de marché"
    >
      <div className="flex items-stretch">
        <div className="flex shrink-0 items-center gap-1.5 border-r border-slate-800 bg-slate-900/80 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          <Activity className="size-3.5 text-cyan-400" />
          <span className="hidden sm:inline">Marchés</span>
          {quoteAge ? (
            <span className="font-normal normal-case text-slate-500" title="Dernière mise à jour">
              · {quoteAge.shortLabel}
            </span>
          ) : null}
        </div>

        <div className="relative min-w-0 flex-1 overflow-hidden py-2.5">
          {loading && !hasQuotes ? (
            <div className="flex h-5 items-center gap-4 px-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <span
                  key={i}
                  className="inline-block h-3 w-28 animate-pulse rounded bg-slate-800"
                />
              ))}
            </div>
          ) : (
            <div className="market-ticker-track flex w-max items-center hover:[animation-play-state:paused]">
              {track.map((quote, index) => (
                <TickerItem key={`${quote.id}-${index}`} quote={quote} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
