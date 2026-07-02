"use client";

import { CircleDollarSign } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";

const SLICE_COLORS = ["#0ea5e9", "#059669"];

type Slice = { name: string; value: number; key: string };

export function PortfolioCompositionKpiCard({
  totalValue,
  positionsValue,
  cashValue,
  externalValueCad = 0,
  nonFinancialAssetsCad = 0,
  detail,
}: {
  totalValue: number;
  positionsValue: number;
  cashValue: number;
  /** Valeur des comptes hors Disnat (déjà convertie en CAD si taux dispo). */
  externalValueCad?: number;
  /** Valeur nette des actifs non-boursiers (équité, déjà convertie en CAD si taux dispo). */
  nonFinancialAssetsCad?: number;
  detail?: string;
}) {
  const ext = Math.max(0, externalValueCad);
  const nonFinancial = Math.max(0, nonFinancialAssetsCad);
  const data: Slice[] = [
    { name: "Titres", value: Math.max(0, positionsValue), key: "positions" },
    {
      name: "Encaisse",
      value: Math.max(0, cashValue),
      key: "cash",
    },
    ...(ext > 0
      ? ([
          {
            name: "Externes",
            value: ext,
            key: "external",
          },
        ] as Slice[])
      : []),
    ...(nonFinancial > 0
      ? ([
          {
            name: "Actifs non-boursiers",
            value: nonFinancial,
            key: "non_financial_assets",
          },
        ] as Slice[])
      : []),
  ];
  const SLICES = [
    ...SLICE_COLORS,
    ...(ext > 0 ? ["#8b5cf6"] : []),
    ...(nonFinancial > 0 ? ["#f59e0b"] : []),
  ];
  const total = data.reduce((s, d) => s + d.value, 0);
  const rows =
    total > 0
      ? data.map((item) => ({
          ...item,
          pct: (item.value / total) * 100,
        }))
      : [];

  return (
    <Card className="overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-slate-500">Valeur du portefeuille</CardTitle>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 tabular-nums">
              {formatCurrency(totalValue, "CAD")}
            </p>
          </div>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
            <CircleDollarSign className="size-5" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {total > 0 ? (
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
            <div className="mx-auto h-40 w-40 shrink-0 sm:mx-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={46}
                    outerRadius={64}
                    paddingAngle={2}
                  >
                    {data.map((entry, index) => (
                      <Cell key={entry.key} fill={SLICES[index % SLICES.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const row = payload[0].payload as Slice;
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                          <p className="font-medium text-slate-950">{row.name}</p>
                          <p className="tabular-nums text-slate-600">{formatCurrency(row.value, "CAD")}</p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="flex min-w-0 flex-1 flex-col justify-center gap-3 text-sm">
              {rows.map((row, index) => (
                <li key={row.key} className="flex min-w-0 items-baseline gap-x-2">
                  <span
                    className="mt-1.5 size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: SLICES[index % SLICES.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate font-semibold text-slate-950">{row.name}</span>
                  <span className="shrink-0 whitespace-nowrap text-right tabular-nums text-slate-700">
                    {formatCurrency(row.value, "CAD")}
                    <span className="text-slate-400"> · </span>
                    <span className="text-slate-500">{formatPercent(row.pct)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Aucune donnée de valorisation</p>
        )}
        {detail ? <p className="mt-4 text-xs text-slate-500">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}
