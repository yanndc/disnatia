"use client";

import { useMemo, useState } from "react";
import type { EnrichedPosition } from "@/features/portfolio/live-enrichment";
import { PositionTransactionsModal } from "@/features/portfolio/position-transactions-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cn,
  formatAccountNumber,
  formatCurrencyDetailed,
  formatNumber,
  formatPercent,
  normalizeCurrency,
} from "@/lib/utils";

type SortKey =
  | "accountName"
  | "ticker"
  | "securityName"
  | "quantity"
  | "averageCost"
  | "totalCost"
  | "displayPrice"
  | "quoteChangePerShare"
  | "displayDayGainLoss"
  | "displayMarketValue"
  | "loanValue"
  | "unrealizedDollar"
  | "unrealizedPct"
  | "weightPct"
  | "assetType";

function toDate(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function formatQuoteAge(fetchedAt: Date | string | null) {
  if (!fetchedAt) return null;
  const date = toDate(fetchedAt);
  if (!date || Number.isNaN(date.getTime())) return null;

  const ageMs = Date.now() - date.getTime();
  const ageMinutes = Math.max(0, Math.round(ageMs / 60_000));

  if (ageMinutes < 60) {
    return `${ageMinutes} min`;
  }

  const ageHours = Math.round(ageMinutes / 60);
  if (ageHours < 48) {
    return `${ageHours} h`;
  }

  return `${Math.round(ageHours / 24)} j`;
}

function totalCostBase(p: EnrichedPosition): number | null {
  if (
    p.averageCost === null ||
    !Number.isFinite(p.averageCost) ||
    p.quantity <= 0
  ) {
    return null;
  }
  return p.quantity * p.averageCost;
}

function unrealizedDollar(p: EnrichedPosition): number | null {
  if (
    p.unrealizedGainLoss !== null &&
    Number.isFinite(p.unrealizedGainLoss)
  ) {
    return p.unrealizedGainLoss;
  }
  const cost = totalCostBase(p);
  if (cost === null) return null;
  return p.displayMarketValue - cost;
}

function unrealizedPct(p: EnrichedPosition): number | null {
  const cost = totalCostBase(p);
  if (cost === null || cost <= 0) return null;
  const u = unrealizedDollar(p);
  if (u === null) return null;
  return (u / cost) * 100;
}

/** Libellé affiché dans la colonne compte : sans le mot « Compte » (souvent présent dans l’export Disnat). */
function positionAccountDisplayLabel(raw: string): string {
  const cleaned = raw
    .replace(/\bcompte\b/giu, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "—";
}

function positionAccountFilterKey(p: EnrichedPosition): string {
  return p.accountKey ? p.accountKey : `name:${p.accountName}`;
}

function positionAssetClassValue(p: EnrichedPosition): string {
  return (p.assetType ?? p.sector ?? "").trim();
}

function sortPositions(
  rows: EnrichedPosition[],
  sortKey: SortKey,
  desc: boolean,
): EnrichedPosition[] {
  const mul = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = rowSortValue(a, sortKey);
    const vb = rowSortValue(b, sortKey);
    if (typeof va === "string" || typeof vb === "string") {
      return mul * String(va ?? "").localeCompare(String(vb ?? ""), "fr");
    }
    const na =
      typeof va === "number" && Number.isFinite(va) ? va : Number.NEGATIVE_INFINITY;
    const nb =
      typeof vb === "number" && Number.isFinite(vb) ? vb : Number.NEGATIVE_INFINITY;
    if (na === nb) return 0;
    return na < nb ? -mul : mul;
  });
}

function rowSortValue(p: EnrichedPosition, key: SortKey): string | number | null {
  switch (key) {
    case "accountName":
      return positionAccountDisplayLabel(p.accountName);
    case "ticker":
      return p.ticker;
    case "securityName":
      return p.securityName ?? "";
    case "quantity":
      return p.quantity;
    case "averageCost":
      return p.averageCost ?? Number.NEGATIVE_INFINITY;
    case "totalCost":
      return totalCostBase(p) ?? Number.NEGATIVE_INFINITY;
    case "displayPrice":
      return p.displayPrice ?? Number.NEGATIVE_INFINITY;
    case "quoteChangePerShare":
      return p.quoteChangePerShare ?? Number.NEGATIVE_INFINITY;
    case "displayDayGainLoss":
      return p.displayDayGainLoss ?? Number.NEGATIVE_INFINITY;
    case "displayMarketValue":
      return p.displayMarketValue;
    case "loanValue":
      return p.loanValue ?? Number.NEGATIVE_INFINITY;
    case "unrealizedDollar":
      return unrealizedDollar(p) ?? Number.NEGATIVE_INFINITY;
    case "unrealizedPct":
      return unrealizedPct(p) ?? Number.NEGATIVE_INFINITY;
    case "weightPct":
      return p.weightPct ?? Number.NEGATIVE_INFINITY;
    case "assetType":
      return p.assetType ?? p.sector ?? "";
    default:
      return null;
  }
}

function SignedCurrencyDetail({
  value,
  currency,
}: {
  value: number | null;
  currency: string;
}) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-slate-400">—</span>;
  }
  const cls =
    value > 0 ? "text-emerald-700" : value < 0 ? "text-red-600" : "text-slate-700";
  return (
    <span className={cls}>{formatCurrencyDetailed(value, currency, 2)}</span>
  );
}

function SignedPercent({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-slate-400">—</span>;
  }
  const cls =
    value > 0 ? "text-emerald-700" : value < 0 ? "text-red-600" : "text-slate-700";
  return <span className={cls}>{formatPercent(value)}</span>;
}

const CURRENCY_RANK: Record<string, number> = {
  CAD: 0,
  USD: 1,
};

function currencyGroupOrder(a: string, b: string) {
  const ca = normalizeCurrency(a);
  const cb = normalizeCurrency(b);
  const ra = CURRENCY_RANK[ca] ?? 99;
  const rb = CURRENCY_RANK[cb] ?? 99;
  if (ra !== rb) return ra - rb;
  return ca.localeCompare(cb, "fr");
}

const filterSelectClass =
  "h-9 shrink-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none transition-colors focus:border-slate-400";

export function PositionsTable({
  positions,
  initialAccountKey,
}: {
  positions: EnrichedPosition[];
  /** Pré-remplit le filtre compte (ex. `?accountKey=` depuis Comptes). */
  initialAccountKey?: string | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("displayMarketValue");
  const [sortDesc, setSortDesc] = useState(true);
  const [globalFilter, setGlobalFilter] = useState("");
  const [filterCurrency, setFilterCurrency] = useState<string>("");
  const [filterAccountKey, setFilterAccountKey] = useState<string>(() =>
    (initialAccountKey ?? "").trim(),
  );
  const [filterQuoteMode, setFilterQuoteMode] = useState<"" | "live" | "snapshot">(
    "",
  );
  const [filterAssetClass, setFilterAssetClass] = useState<string>("");
  const [txModalPosition, setTxModalPosition] = useState<EnrichedPosition | null>(null);

  const filterOptions = useMemo(() => {
    const curs = new Set<string>();
    const accountEntries = new Map<string, string>();
    const assets = new Set<string>();
    for (const p of positions) {
      curs.add(normalizeCurrency(p.currency));
      const k = positionAccountFilterKey(p);
      if (!accountEntries.has(k)) {
        const name = positionAccountDisplayLabel(p.accountName);
        const num = formatAccountNumber(p.accountNumber);
        accountEntries.set(k, num ? `${name} · ${num}` : name);
      }
      const a = positionAssetClassValue(p);
      if (a) assets.add(a);
    }
    const currenciesSorted = [...curs].sort((a, b) => currencyGroupOrder(a, b));
    const accountsSorted = [...accountEntries.entries()].sort(([, la], [, lb]) =>
      la.localeCompare(lb, "fr"),
    );
    const assetsSorted = [...assets].sort((a, b) => a.localeCompare(b, "fr"));
    return { currenciesSorted, accountsSorted, assetsSorted };
  }, [positions]);

  const filtered = useMemo(() => {
    const q = globalFilter.trim().toLowerCase();
    return positions.filter((p) => {
      if (filterCurrency && normalizeCurrency(p.currency) !== filterCurrency) {
        return false;
      }
      if (filterAccountKey && positionAccountFilterKey(p) !== filterAccountKey) {
        return false;
      }
      if (filterQuoteMode === "live" && !p.usesLiveQuote) return false;
      if (filterQuoteMode === "snapshot" && p.usesLiveQuote) return false;
      if (filterAssetClass && positionAssetClassValue(p) !== filterAssetClass) {
        return false;
      }
      if (!q) return true;
      const hay = [
        p.ticker,
        p.securityName,
        p.accountName,
        p.currency,
        p.accountNumber,
        formatAccountNumber(p.accountNumber),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [
    positions,
    globalFilter,
    filterCurrency,
    filterAccountKey,
    filterQuoteMode,
    filterAssetClass,
  ]);

  const grouped = useMemo(() => {
    const byCur = new Map<string, EnrichedPosition[]>();
    for (const p of filtered) {
      const cur = normalizeCurrency(p.currency);
      const list = byCur.get(cur) ?? [];
      list.push(p);
      byCur.set(cur, list);
    }
    const entries = [...byCur.entries()].sort(([c1], [c2]) =>
      currencyGroupOrder(c1, c2),
    );
    return entries.map(([currency, rows]) => ({
      currency,
      rows: sortPositions(rows, sortKey, sortDesc),
    }));
  }, [filtered, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
      return;
    }
    setSortKey(key);
    const isText =
      key === "accountName" ||
      key === "ticker" ||
      key === "securityName" ||
      key === "assetType";
    setSortDesc(!isText);
  }

  const th = (key: SortKey, label: string, className = "") => (
    <th
      key={key}
      className={cn(
        "cursor-pointer whitespace-nowrap px-1 py-1 font-medium",
        className,
      )}
      onClick={() => toggleSort(key)}
      scope="col"
    >
      {label}
      {sortKey === key ? (sortDesc ? " ↓" : " ↑") : null}
    </th>
  );

  const filteredCount = filtered.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Input
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder="Rechercher ticker, nom, compte…"
            className="h-9 min-w-[12rem] flex-1 sm:max-w-xs"
          />
          <select
            aria-label="Filtrer par devise"
            className={cn(filterSelectClass, "min-w-[7rem]")}
            value={filterCurrency}
            onChange={(e) => setFilterCurrency(e.target.value)}
          >
            <option value="">Toutes devises</option>
            {filterOptions.currenciesSorted.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrer par compte"
            className={cn(filterSelectClass, "min-w-[10rem] max-w-[16rem]")}
            value={filterAccountKey}
            onChange={(e) => setFilterAccountKey(e.target.value)}
          >
            <option value="">Tous les comptes</option>
            {filterOptions.accountsSorted.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrer par source de cours"
            className={cn(filterSelectClass, "min-w-[9rem]")}
            value={filterQuoteMode}
            onChange={(e) =>
              setFilterQuoteMode(e.target.value as "" | "live" | "snapshot")
            }
          >
            <option value="">Tous les cours</option>
            <option value="live">Cours live</option>
            <option value="snapshot">Projection</option>
          </select>
          <select
            aria-label="Filtrer par classe d’actif"
            className={cn(filterSelectClass, "min-w-[9rem] max-w-[14rem]")}
            value={filterAssetClass}
            onChange={(e) => setFilterAssetClass(e.target.value)}
          >
            <option value="">Toutes les classes</option>
            {filterOptions.assetsSorted.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <p className="shrink-0 text-sm text-slate-500">
          {filteredCount} position{filteredCount !== 1 ? "s" : ""} affichée
          {filteredCount !== 1 ? "s" : ""}
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Aucune position. Vérifie les imports d&apos;opérations sur la page Imports.
        </div>
      ) : null}

      {grouped.map(({ currency, rows }) => (
        <div key={currency} className="space-y-2">
          <h3 className="text-base font-semibold text-slate-900">En {currency}</h3>
          <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[1400px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {th("ticker", "Symbole")}
                  {th("securityName", "Nom")}
                  {th("accountName", "Compte")}
                  <th className="whitespace-nowrap px-1 py-1 font-medium" scope="col">
                    Historique
                  </th>
                  {th("assetType", "Classe")}
                  {th("quantity", "Quantité")}
                  {th("averageCost", "Coût moyen")}
                  {th("totalCost", "Coût total")}
                  {th("displayPrice", "Prix")}
                  {th("quoteChangePerShare", "Variation")}
                  {th("displayDayGainLoss", "Jour")}
                  {th("displayMarketValue", "Valeur")}
                  {th("loanValue", "Emprunt")}
                  {th("unrealizedDollar", "Non réalisé $")}
                  {th("unrealizedPct", "Non réalisé %")}
                  {th("weightPct", "% PF")}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => {
                  const tc = totalCostBase(p);
                  const quoteFetchedAt = toDate(p.quoteFetchedAt);
                  const uDollar = unrealizedDollar(p);
                  const uPct = unrealizedPct(p);
                  const cur = normalizeCurrency(p.currency);
                  const assetLabel = [p.assetType, p.sector]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-1 py-1">
                        <div>
                          <p className="font-semibold text-emerald-700">{p.ticker}</p>
                          {p.usesLiveQuote ? (
                            <p className="text-[10px] uppercase tracking-wide text-emerald-700">
                              cours live
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-[220px] px-1 py-1 text-slate-700">
                        <p className="line-clamp-2">{p.securityName || "—"}</p>
                      </td>
                      <td className="px-1 py-1 text-slate-700">
                        <div>
                          <p className="font-medium">
                            {positionAccountDisplayLabel(p.accountName)}
                          </p>
                          {formatAccountNumber(p.accountNumber) ? (
                            <p className="text-xs text-slate-500">
                              {formatAccountNumber(p.accountNumber)}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-1 py-1">
                        {p.accountKey ? (
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-7 whitespace-nowrap px-2 text-xs"
                            onClick={() => setTxModalPosition(p)}
                          >
                            Voir
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="max-w-[160px] px-1 py-1 text-xs text-slate-600">
                        {assetLabel || "—"}
                      </td>
                      <td className="px-1 py-1 text-slate-700 tabular-nums">
                        {formatNumber(p.quantity, 4)}
                      </td>
                      <td className="px-1 py-1 text-slate-700 tabular-nums">
                        {p.averageCost !== null &&
                        Number.isFinite(p.averageCost) ? (
                          formatCurrencyDetailed(p.averageCost, cur, 2)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-1 py-1 text-slate-700 tabular-nums">
                        {tc !== null ? (
                          formatCurrencyDetailed(tc, cur, 2)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        <div className="tabular-nums text-slate-700">
                          {p.displayPrice !== null &&
                          Number.isFinite(p.displayPrice) ? (
                            formatCurrencyDetailed(p.displayPrice, cur, 2)
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                          <p className="text-[10px] font-normal normal-case text-slate-400">
                            {p.usesLiveQuote && quoteFetchedAt
                              ? `Direct · ${formatQuoteAge(quoteFetchedAt)}`
                              : "Import"}
                          </p>
                        </div>
                      </td>
                      <td className="px-1 py-1 tabular-nums">
                        <SignedCurrencyDetail
                          value={p.quoteChangePerShare}
                          currency={cur}
                        />
                      </td>
                      <td className="px-1 py-1 tabular-nums">
                        <SignedCurrencyDetail
                          value={p.displayDayGainLoss}
                          currency={cur}
                        />
                      </td>
                      <td className="px-1 py-1 font-medium text-slate-900 tabular-nums">
                        {formatCurrencyDetailed(p.displayMarketValue, cur, 2)}
                      </td>
                      <td className="px-1 py-1 text-slate-700 tabular-nums">
                        {p.loanValue !== null && Number.isFinite(p.loanValue) ? (
                          formatCurrencyDetailed(p.loanValue, cur, 2)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-1 py-1 tabular-nums">
                        <SignedCurrencyDetail value={uDollar} currency={cur} />
                      </td>
                      <td className="px-1 py-1 tabular-nums">
                        <SignedPercent value={uPct} />
                      </td>
                      <td className="px-1 py-1 text-slate-700 tabular-nums">
                        {p.weightPct === null ? (
                          "—"
                        ) : (
                          formatPercent(p.weightPct)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-500">
                Aucune ligne pour ce filtre.
              </p>
            ) : null}
          </div>
        </div>
      ))}
      <PositionTransactionsModal
        position={txModalPosition}
        open={txModalPosition !== null}
        onClose={() => setTxModalPosition(null)}
      />
    </div>
  );
}
