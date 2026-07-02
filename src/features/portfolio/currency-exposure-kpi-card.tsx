"use client";

import { TrendingUp } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";

const SLICE_COLORS = ["#0ea5e9", "#334155", "#64748b", "#94a3b8"];

export function CurrencyExposureKpiCard({
  currencyExposure,
}: {
  currencyExposure: { currency: string; value: number }[];
}) {
  const total = currencyExposure.reduce((sum, item) => sum + item.value, 0);
  const rows =
    total > 0
      ? currencyExposure.map((item) => ({
          ...item,
          pct: (item.value / total) * 100,
        }))
      : [];

  return (
    <Card className="overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-slate-500">Répartition CAD / USD</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Inclut les titres + l&apos;encaisse Disnat. Exclut les comptes externes et les actifs non-boursiers.
            </p>
          </div>
          <div className="flex size-10 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
            <TrendingUp className="size-5" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {total > 0 ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="mx-auto h-40 w-40 shrink-0 sm:mx-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={currencyExposure}
                    dataKey="value"
                    nameKey="currency"
                    innerRadius={46}
                    outerRadius={64}
                    paddingAngle={2}
                  >
                    {currencyExposure.map((entry, index) => (
                      <Cell key={entry.currency} fill={SLICE_COLORS[index % SLICE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const row = payload[0].payload as { currency: string; value: number };
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                          <p className="font-medium text-slate-950">{row.currency}</p>
                          <p className="tabular-nums text-slate-600">
                            {formatCurrency(row.value, row.currency)}
                          </p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="flex min-w-0 flex-1 flex-col justify-center gap-3 text-sm">
              {rows.map((row, index) => (
                <li key={row.currency} className="flex items-baseline gap-x-2">
                  <span
                    className="mt-1.5 size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: SLICE_COLORS[index % SLICE_COLORS.length] }}
                  />
                  <span className="font-semibold text-slate-950 whitespace-nowrap">{row.currency}</span>
                  <span className="ml-auto text-right tabular-nums text-slate-700 whitespace-nowrap">
                    {formatCurrency(row.value, row.currency)}
                    <span className="text-slate-400"> · </span>
                    <span className="text-slate-500">{formatPercent(row.pct)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Aucune exposition en devise</p>
        )}
      </CardContent>
    </Card>
  );
}
