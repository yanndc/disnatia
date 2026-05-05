"use client";

import { useMemo, useState } from "react";
import type { EnrichedPosition } from "@/features/portfolio/queries";
import { Input } from "@/components/ui/input";
import {
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
      return p.accountName;
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

export function PositionsTable({ positions }: { positions: EnrichedPosition[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("displayMarketValue");
  const [sortDesc, setSortDesc] = useState(true);
  const [globalFilter, setGlobalFilter] = useState("");

  const filtered = useMemo(() => {
    const q = globalFilter.trim().toLowerCase();
    if (!q) return positions;
    return positions.filter((p) => {
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
  }, [positions, globalFilter]);

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
      className={`cursor-pointer whitespace-nowrap px-3 py-3 font-medium ${className}`}
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
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Input
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder="Rechercher ticker, nom, compte…"
          className="md:max-w-md"
        />
        <p className="text-sm text-slate-500">
          {filteredCount} position{filteredCount !== 1 ? "s" : ""} affichée
          {filteredCount !== 1 ? "s" : ""}
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Aucune position. Importe un fichier Disnat pour remplir la table.
        </div>
      ) : null}

      {grouped.map(({ currency, rows }) => (
        <div key={currency} className="space-y-2">
          <h3 className="text-base font-semibold text-slate-900">
            ACTIONS détenu(e)s dans le(s) compte(s) en {currency}
          </h3>
          <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[1400px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {th("accountName", "Compte")}
                  {th("ticker", "Symbole")}
                  {th("securityName", "Nom")}
                  {th("assetType", "Classe")}
                  {th("quantity", "Quantité")}
                  {th("averageCost", "Coût moyen")}
                  {th("totalCost", "Coût total")}
                  {th("displayPrice", "Prix actuel")}
                  {th("quoteChangePerShare", "Variation ($)")}
                  {th("displayDayGainLoss", "Profits du jour ($)")}
                  {th("displayMarketValue", "Valeur au marché")}
                  {th("loanValue", "Valeur d'emprunt")}
                  {th("unrealizedDollar", "Profits non réalisés ($)")}
                  {th("unrealizedPct", "Profits non réalisés (%)")}
                  {th("weightPct", "% portefeuille")}
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
                      <td className="px-3 py-3 text-slate-700">
                        <div>
                          <p className="font-medium">{p.accountName}</p>
                          {formatAccountNumber(p.accountNumber) ? (
                            <p className="text-xs text-slate-500">
                              {formatAccountNumber(p.accountNumber)}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div>
                          <p className="font-semibold text-emerald-700">{p.ticker}</p>
                          {p.usesLiveQuote ? (
                            <p className="text-[10px] uppercase tracking-wide text-emerald-700">
                              cours live
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-[220px] px-3 py-3 text-slate-700">
                        <p className="line-clamp-2">{p.securityName || "—"}</p>
                      </td>
                      <td className="max-w-[160px] px-3 py-3 text-xs text-slate-600">
                        {assetLabel || "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-700 tabular-nums">
                        {formatNumber(p.quantity, 4)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 tabular-nums">
                        {p.averageCost !== null &&
                        Number.isFinite(p.averageCost) ? (
                          formatCurrencyDetailed(p.averageCost, cur, 2)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-700 tabular-nums">
                        {tc !== null ? (
                          formatCurrencyDetailed(tc, cur, 2)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
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
                              : "Snapshot Disnat"}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        <SignedCurrencyDetail
                          value={p.quoteChangePerShare}
                          currency={cur}
                        />
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        <SignedCurrencyDetail
                          value={p.displayDayGainLoss}
                          currency={cur}
                        />
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-900 tabular-nums">
                        {formatCurrencyDetailed(p.displayMarketValue, cur, 2)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 tabular-nums">
                        {p.loanValue !== null && Number.isFinite(p.loanValue) ? (
                          formatCurrencyDetailed(p.loanValue, cur, 2)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        <SignedCurrencyDetail value={uDollar} currency={cur} />
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        <SignedPercent value={uPct} />
                      </td>
                      <td className="px-3 py-3 text-slate-700 tabular-nums">
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
    </div>
  );
}
