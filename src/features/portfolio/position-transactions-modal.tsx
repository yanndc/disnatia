"use client";

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { EnrichedPosition } from "@/features/portfolio/live-enrichment";
import { TX_CATEGORY_LABELS } from "@/lib/csv/tx-category";
import type { TxCategory } from "@/generated/prisma/enums";
import {
  formatCurrencyDetailed,
  formatNumber,
  formatPercent,
  normalizeCurrency,
} from "@/lib/utils";

type ApiRow = {
  id: string;
  tradeDate: string | null;
  settlementDate: string | null;
  transactionType: string | null;
  txCategory: TxCategory | null;
  ticker: string | null;
  securityName: string | null;
  market: string | null;
  currency: string | null;
  priceDevise: string | null;
  assetClass: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  fees: number | null;
};

function normCurrency(raw?: string | null) {
  if (!raw) return "CAD";
  const up = raw.toUpperCase();
  if (up === "US") return "USD";
  if (up === "CAN") return "CAD";
  return up;
}

function fmtMoney(v: number | null | undefined, currency?: string | null) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: normCurrency(currency),
    minimumFractionDigits: 2,
  }).format(v);
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("fr-CA");
}

function fmtQty(v: number | null) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 6 }).format(v);
}

function signedMoneyClass(value: number) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-red-600";
  return "text-slate-700";
}

type QuoteHistoryPayload = {
  yahooSymbolMapped: string;
  referenceSessionDate: string;
  priorSessionDate: string;
  priorSessionCloseInDb: number | null;
  liveQuote: {
    price: number;
    changeAmount: number | null;
    previousClose: number | null;
    fetchedAt: string;
    yahooSymbol: string | null;
  } | null;
  impliedSessionDelta: number | null;
  impliedSessionDeltaPct: number | null;
  days: number;
  dailyCloses: Array<{
    date: string;
    closePrice: number;
    source: string;
    yahooSymbol: string | null;
    changeVsPrevStored: number | null;
    changePctVsPrevStored: number | null;
  }>;
};

function PositionQuoteHistoryPanel({
  payload,
  currency,
}: {
  payload: QuoteHistoryPayload;
  currency: string;
}) {
  const cur = normalizeCurrency(currency);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        <p>
          <span className="font-medium text-slate-900">Symbole Yahoo mappé :</span>{" "}
          {payload.yahooSymbolMapped}
        </p>
        <p className="mt-1">
          <span className="font-medium text-slate-900">Séance de référence :</span>{" "}
          {payload.referenceSessionDate}
          {" · "}
          <span className="font-medium text-slate-900">Veille (Positions) :</span>{" "}
          {payload.priorSessionDate}
          {payload.priorSessionCloseInDb != null ? (
            <>
              {" → "}
              {formatCurrencyDetailed(payload.priorSessionCloseInDb, cur, 2)}
            </>
          ) : (
            <span className="text-amber-700"> (absente en base)</span>
          )}
        </p>
        {payload.liveQuote ? (
          <p className="mt-1">
            <span className="font-medium text-slate-900">Live en base :</span>{" "}
            {formatCurrencyDetailed(payload.liveQuote.price, cur, 2)}
            {payload.liveQuote.changeAmount != null ? (
              <>
                {" · changeAmount "}
                {formatCurrencyDetailed(payload.liveQuote.changeAmount, cur, 2)}
              </>
            ) : null}
            {payload.liveQuote.previousClose != null ? (
              <>
                {" · previousClose "}
                {formatCurrencyDetailed(payload.liveQuote.previousClose, cur, 2)}
              </>
            ) : null}
            {" · "}
            {payload.liveQuote.yahooSymbol ?? "—"}
            {" · "}
            {new Date(payload.liveQuote.fetchedAt).toLocaleString("fr-CA")}
          </p>
        ) : (
          <p className="mt-1 text-amber-800">Aucune ligne dans portfolio_live_quotes.</p>
        )}
        {payload.impliedSessionDelta != null ? (
          <p className="mt-1">
            <span className="font-medium text-slate-900">Δ implicite (live − veille base) :</span>{" "}
            <span className={signedMoneyClass(payload.impliedSessionDelta)}>
              {formatCurrencyDetailed(payload.impliedSessionDelta, cur, 2)}
            </span>
            {payload.impliedSessionDeltaPct != null ? (
              <span className={signedMoneyClass(payload.impliedSessionDelta)}>
                {" "}
                ({formatPercent(payload.impliedSessionDeltaPct)})
              </span>
            ) : null}
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-slate-500">
          Lecture seule — pas de rafraîchissement Yahoo ici. Compare avec ton courtier / Yahoo sur{" "}
          {payload.yahooSymbolMapped}.
        </p>
      </div>

      {payload.dailyCloses.length === 0 ? (
        <p className="text-sm text-slate-500">
          Aucune clôture dans portfolio_daily_prices sur les {payload.days} derniers jours.
        </p>
      ) : (
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="sticky top-0 bg-white text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2 font-medium">Date</th>
              <th className="px-2 py-2 font-medium">Clôture</th>
              <th className="px-2 py-2 font-medium">Source</th>
              <th className="px-2 py-2 font-medium">Symbole</th>
              <th className="px-2 py-2 font-medium">Δ vs jour stocké avant</th>
              <th className="px-2 py-2 font-medium">Δ %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payload.dailyCloses.map((row) => (
              <tr
                key={row.date}
                className={
                  row.date === payload.priorSessionDate
                    ? "bg-amber-50/80 text-slate-800"
                    : "text-slate-800"
                }
              >
                <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-600">
                  {row.date}
                  {row.date === payload.priorSessionDate ? (
                    <span className="ml-1 text-[10px] font-medium text-amber-800">veille</span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-2 py-2 tabular-nums font-medium">
                  {formatCurrencyDetailed(row.closePrice, cur, 2)}
                </td>
                <td className="px-2 py-2 text-slate-600">{row.source}</td>
                <td className="max-w-[120px] truncate px-2 py-2 text-slate-500" title={row.yahooSymbol ?? ""}>
                  {row.yahooSymbol ?? "—"}
                </td>
                <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                  {row.changeVsPrevStored != null ? (
                    <span className={signedMoneyClass(row.changeVsPrevStored)}>
                      {formatCurrencyDetailed(row.changeVsPrevStored, cur, 2)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                  {row.changePctVsPrevStored != null ? (
                    <span className={signedMoneyClass(row.changeVsPrevStored ?? 0)}>
                      {formatPercent(row.changePctVsPrevStored)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PositionDetailQuoteSummary({ position }: { position: EnrichedPosition }) {
  const cur = normalizeCurrency(position.currency);
  const dpp = position.displayPrice;
  const delta = position.quoteChangePerShare;
  const dayPct = position.quoteSessionChangePct;
  const dayPnl = position.displayDayGainLoss;

  const stat = (label: string, children: ReactNode) => (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-0.5 font-medium tabular-nums text-slate-900">{children}</div>
    </div>
  );

  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3 lg:grid-cols-6">
        {stat("Quantité", formatNumber(position.quantity, 4))}
        {stat(
          "Prix",
          dpp !== null && Number.isFinite(dpp) ? (
            formatCurrencyDetailed(dpp, cur, 2)
          ) : (
            <span className="text-slate-400">—</span>
          ),
        )}
        {stat(
          "Variation / action",
          delta !== null && Number.isFinite(delta) ? (
            <span className={signedMoneyClass(delta)}>{formatCurrencyDetailed(delta, cur, 2)}</span>
          ) : (
            <span className="text-slate-400">—</span>
          ),
        )}
        {stat(
          "% jour",
          dayPct !== null && Number.isFinite(dayPct) ? (
            <span className={signedMoneyClass(delta ?? 0)}>{formatPercent(dayPct)}</span>
          ) : (
            <span className="text-slate-400">—</span>
          ),
        )}
        {stat(
          "Jour",
          dayPnl !== null && Number.isFinite(dayPnl) ? (
            <span className={signedMoneyClass(dayPnl)}>{formatCurrencyDetailed(dayPnl, cur, 2)}</span>
          ) : (
            <span className="text-slate-400">—</span>
          ),
        )}
        {stat(
          "Valeur",
          formatCurrencyDetailed(position.displayMarketValue, cur, 2),
        )}
      </div>
      {position.quoteChangePerShare === null ? (
        <p className="text-[11px] text-slate-500">
          Variation jour indisponible pour cette cotation — actualiser les cours sur Positions si besoin.
        </p>
      ) : !position.usesLiveQuote ? (
        <p className="text-[11px] text-slate-500">
          Prix et valeur suivent l’import ; le jour s’appuie sur la dernière cotation marché stockée.
        </p>
      ) : null}
    </div>
  );
}

export function PositionTransactionsModal({
  position,
  open,
  onClose,
}: {
  position: EnrichedPosition | null;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [tab, setTab] = useState<"operations" | "quotes">("operations");
  const [rows, setRows] = useState<ApiRow[] | null>(null);
  const [quoteHistory, setQuoteHistory] = useState<QuoteHistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open) {
      if (!d.open) d.showModal();
    } else if (d.open) {
      d.close();
    }
  }, [open]);

  const load = useCallback(async () => {
    if (!position || !position.accountKey) return;
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const params = new URLSearchParams({
        accountKey: position.accountKey,
        ticker: position.ticker,
        currency: position.currency,
      });
      const res = await fetch(`/api/portfolio/position-transactions?${params}`);
      const data = (await res.json()) as { rows?: ApiRow[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Échec du chargement");
        return;
      }
      setRows(data.rows ?? []);
    } catch {
      setError("Réseau ou serveur indisponible");
    } finally {
      setLoading(false);
    }
  }, [position]);

  const loadQuotes = useCallback(async () => {
    if (!position) return;
    setLoadingQuotes(true);
    setQuoteError(null);
    setQuoteHistory(null);
    try {
      const params = new URLSearchParams({
        ticker: position.ticker,
        currency: position.currency,
        days: "90",
      });
      const res = await fetch(`/api/portfolio/position-quote-history?${params}`);
      const data = (await res.json()) as QuoteHistoryPayload & { error?: string };
      if (!res.ok) {
        setQuoteError(data.error ?? "Échec du chargement des cours");
        return;
      }
      setQuoteHistory(data);
    } catch {
      setQuoteError("Réseau ou serveur indisponible");
    } finally {
      setLoadingQuotes(false);
    }
  }, [position]);

  useEffect(() => {
    if (open && position) {
      setTab("operations");
      void load();
      void loadQuotes();
    }
  }, [open, position, load, loadQuotes]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const syncParent = () => onClose();
    d.addEventListener("close", syncParent);
    return () => d.removeEventListener("close", syncParent);
  }, [onClose]);

  if (!position) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(1000px,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-0 shadow-xl outline-none backdrop:bg-slate-900/40"
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-950">
              Détail · {position.ticker}
            </h2>
            <p className="mt-0.5 max-w-xl text-xs text-slate-600 line-clamp-2">
              {position.securityName || "—"} · {position.accountName}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Button
                type="button"
                variant={tab === "operations" ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setTab("operations")}
              >
                Opérations
              </Button>
              <Button
                type="button"
                variant={tab === "quotes" ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setTab("quotes")}
              >
                Cours en base
              </Button>
            </div>
            <PositionDetailQuoteSummary position={position} />
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={() => {
                void load();
                void loadQuotes();
              }}
            >
              Actualiser
            </Button>
            <Button type="button" variant="secondary" className="h-8 px-2 text-xs" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === "quotes" ? (
            loadingQuotes ? (
              <p className="text-sm text-slate-500">Chargement des clôtures…</p>
            ) : quoteError ? (
              <p className="text-sm text-red-600">{quoteError}</p>
            ) : quoteHistory ? (
              <PositionQuoteHistoryPanel payload={quoteHistory} currency={position.currency} />
            ) : null
          ) : loading ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : rows && rows.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune opération trouvée pour cette ligne.</p>
          ) : rows ? (
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="sticky top-0 bg-white text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">Date règl.</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Cat.</th>
                  <th className="px-2 py-2 font-medium">Symbole</th>
                  <th className="px-2 py-2 font-medium">Qté</th>
                  <th className="px-2 py-2 font-medium">Prix</th>
                  <th className="px-2 py-2 font-medium">Montant</th>
                  <th className="px-2 py-2 font-medium">Frais</th>
                  <th className="px-2 py-2 font-medium">Classe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const catLabel = r.txCategory ? TX_CATEGORY_LABELS[r.txCategory] ?? r.txCategory : "—";
                  const cur = r.currency ?? position.currency;
                  return (
                    <tr key={r.id} className="text-slate-800">
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-600">
                        {fmtDate(r.settlementDate ?? r.tradeDate)}
                      </td>
                      <td className="max-w-[140px] px-2 py-2 text-slate-700">
                        <span className="line-clamp-2" title={r.transactionType ?? ""}>
                          {r.transactionType ?? "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-slate-600">{catLabel}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-medium">{r.ticker ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{fmtQty(r.quantity)}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{fmtMoney(r.price, cur)}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{fmtMoney(r.amount, cur)}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{fmtMoney(r.fees, cur)}</td>
                      <td className="max-w-[100px] px-2 py-2 text-slate-600">{r.assetClass ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
