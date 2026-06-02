"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export type IncomeYearChartRow = {
  year: number;
  DIVIDEND: number;
  STOCK_DIVIDEND: number;
  INTEREST: number;
  TAX_WITHHOLD: number;
};

const COLORS = {
  dividendes: "#0ea5e9",
  dividendesActions: "#38bdf8",
  interets: "#2563eb",
  retenues: "#ea580c",
} as const;

function buildChartRows(rows: IncomeYearChartRow[]) {
  return rows
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((y) => ({
      year: String(y.year),
      dividendes: y.DIVIDEND,
      dividendesActions: y.STOCK_DIVIDEND,
      interets: y.INTEREST,
      retenues: y.TAX_WITHHOLD,
      net: y.DIVIDEND + y.STOCK_DIVIDEND + y.INTEREST + y.TAX_WITHHOLD,
    }));
}

function formatAxis(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value));
}

export function IncomeByYearChart({ yearData }: { yearData: IncomeYearChartRow[] }) {
  const chartData = buildChartRows(yearData);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Totaux annuels</CardTitle>
        <p className="text-sm font-normal text-slate-500">
          Répartition par type de revenu (barres empilées)
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="year"
                tick={{ fill: "#64748b", fontSize: 12 }}
                axisLine={{ stroke: "#e2e8f0" }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatAxis}
                tick={{ fill: "#64748b", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                cursor={{ fill: "#f8fafc" }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const net = payload[0]?.payload?.net as number | undefined;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                      <p className="font-semibold text-slate-950">{label}</p>
                      <ul className="mt-1 space-y-0.5 text-slate-600">
                        {payload.map((entry) => {
                          const v = Number(entry.value);
                          const display =
                            entry.dataKey === "retenues" ? Math.abs(v) : v;
                          return (
                            <li
                              key={String(entry.dataKey ?? entry.name)}
                              className="flex justify-between gap-4"
                            >
                              <span>{entry.name}</span>
                              <span className="tabular-nums font-medium text-slate-800">
                                {formatCurrency(display)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {net !== undefined && (
                        <p className="mt-2 border-t border-slate-100 pt-2 font-medium text-emerald-700">
                          Net : {formatCurrency(net)}
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                formatter={(value) => (
                  <span className="text-slate-600">{value}</span>
                )}
              />
              <Bar
                dataKey="dividendes"
                name="Dividendes"
                stackId="income"
                fill={COLORS.dividendes}
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="dividendesActions"
                name="Divid. actions"
                stackId="income"
                fill={COLORS.dividendesActions}
              />
              <Bar
                dataKey="interets"
                name="Intérêts"
                stackId="income"
                fill={COLORS.interets}
              />
              <Bar dataKey="retenues" name="Retenues" stackId="income" fill={COLORS.retenues} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
