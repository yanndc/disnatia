"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

const colors = ["#0f172a", "#334155", "#64748b", "#94a3b8", "#cbd5e1"];

export function PortfolioCharts({
  currencyExposure,
  topPositions,
}: {
  currencyExposure: { currency: string; value: number }[];
  topPositions: { ticker: string; marketValue: number }[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Allocation par devise</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={currencyExposure}
                  dataKey="value"
                  nameKey="currency"
                  innerRadius={64}
                  outerRadius={96}
                  paddingAngle={2}
                >
                  {currencyExposure.map((entry, index) => (
                    <Cell key={entry.currency} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(Number(value), "CAD")} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Top positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topPositions}>
                <XAxis dataKey="ticker" tickLine={false} axisLine={false} />
                <YAxis hide />
                <Tooltip formatter={(value) => formatCurrency(Number(value), "CAD")} />
                <Bar dataKey="marketValue" fill="#0f172a" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
