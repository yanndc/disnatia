"use client";

import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";

export function TopPositionsKpiCard({
  topPositions,
  totalValue,
}: {
  topPositions: { ticker: string; marketValue: number }[];
  /** Valeur totale du portefeuille (titres + encaisse) pour le % affiché */
  totalValue: number;
}) {
  const denom = totalValue > 0 ? totalValue : 0;

  const rows = [...topPositions]
    .map((p) => ({
      ticker: p.ticker,
      marketValue: p.marketValue,
      weightPct: denom > 0 ? (p.marketValue / denom) * 100 : 0,
    }))
    .toSorted((a, b) => b.marketValue - a.marketValue);

  const maxValue = rows[0]?.marketValue ?? 0;

  return (
    <Card className="transition hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-slate-500">Plus gros titres</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Même symbole sur plusieurs comptes = une ligne (somme). Titres du même indice (ex. SPY + VFV,
              QQQ + XQQ) sont regroupés pour le poids. Poids vs tout le portefeuille, équivalent CAD si le taux
              est disponible.
            </p>
          </div>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
            <BarChart3 className="size-5" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {rows.map((row, index) => {
              const widthPct = maxValue > 0 ? Math.max(4, (row.marketValue / maxValue) * 100) : 0;
              return (
                <li key={`${row.ticker}-${index}`} className="grid gap-1.5 sm:grid-cols-[minmax(0,4.5rem)_1fr] sm:items-center sm:gap-3">
                  <span className="truncate text-xs font-medium text-slate-700" title={row.ticker}>
                    {row.ticker}
                  </span>
                  <div className="flex min-w-0 items-center gap-2">
                    <div
                      className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100"
                      role="presentation"
                    >
                      <div
                        className="h-full rounded-full bg-slate-900"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-right text-[11px] tabular-nums leading-none text-slate-600 sm:min-w-[9.5rem]">
                      {formatCurrency(row.marketValue, "CAD")}{" "}
                      <span className="text-slate-400">·</span> {formatPercent(row.weightPct)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Aucune position à afficher</p>
        )}
      </CardContent>
    </Card>
  );
}
