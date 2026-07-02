import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IncomeByYearChart } from "@/features/portfolio/income-by-year-chart";
import { RefreshQuotesButton } from "@/features/portfolio/refresh-quotes-button";
import { getIncomeByYear, getAccountsWithStats } from "@/features/portfolio/queries";

export const dynamic = "force-dynamic";

function normCurrency(raw = "CAD") {
  const up = raw.toUpperCase();
  if (up === "US") return "USD";
  if (up === "CAN") return "CAD";
  return up;
}

function fmt(v: number, currency = "CAD") {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: normCurrency(currency),
    minimumFractionDigits: 2,
  }).format(v);
}

export default async function RevenusPage() {
  const [yearData, accounts] = await Promise.all([
    getIncomeByYear().catch(() => []),
    getAccountsWithStats().catch(() => []),
  ]);

  const accountLabel = (key: string) => {
    const acc = accounts.find((a) => a.accountKey === key);
    if (!acc) return key;
    return [acc.accountType, acc.accountNumber, acc.currency].filter(Boolean).join(" · ");
  };

  const grandDividend = yearData.reduce(
    (s, y) => s + y.DIVIDEND + y.STOCK_DIVIDEND,
    0,
  );
  const grandInterest = yearData.reduce((s, y) => s + y.INTEREST, 0);
  const grandWithhold = yearData.reduce((s, y) => s + y.TAX_WITHHOLD, 0);

  if (yearData.length === 0) {
    return (
      <Card>
        <CardContent className="flex min-h-60 flex-col items-center justify-center text-center">
          <h2 className="text-lg font-semibold text-slate-950">Aucun revenu enregistré</h2>
          <p className="mt-2 text-sm text-slate-500">
            Importez des fichiers Historique.xlsx pour alimenter cette vue.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">Tableau de bord</p>
          <h2 className="text-2xl font-semibold text-slate-950">Revenus de placement</h2>
          <p className="mt-1 text-sm text-slate-500">
            Dividendes, intérêts et retenues d&apos;impôt extraits de l&apos;historique
          </p>
        </div>
        <RefreshQuotesButton />
      </section>

      {/* Totaux globaux */}
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Dividendes totaux" value={fmt(grandDividend)} color="sky" />
        <SummaryCard label="Intérêts totaux" value={fmt(grandInterest)} color="blue" />
        <SummaryCard
          label="Retenues d'impôt"
          value={fmt(Math.abs(grandWithhold))}
          color="orange"
          note="Montant prélevé"
        />
      </div>

      <IncomeByYearChart yearData={yearData} />

      {/* Tableau par année */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Détail par année</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Année</th>
                  <th className="px-4 py-2 text-right">Dividendes</th>
                  <th className="px-4 py-2 text-right">Dividendes actions</th>
                  <th className="px-4 py-2 text-right">Intérêts</th>
                  <th className="px-4 py-2 text-right">Retenues</th>
                  <th className="px-4 py-2 text-right">Net (div + int - ret)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {yearData.map((y) => {
                  const net =
                    y.DIVIDEND + y.STOCK_DIVIDEND + y.INTEREST + y.TAX_WITHHOLD;
                  return (
                    <tr key={y.year} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-semibold text-slate-950">{y.year}</td>
                      <td className="px-4 py-2 text-right text-sky-700">
                        {y.DIVIDEND > 0 ? fmt(y.DIVIDEND) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-sky-600">
                        {y.STOCK_DIVIDEND > 0 ? fmt(y.STOCK_DIVIDEND) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-blue-700">
                        {y.INTEREST > 0 ? fmt(y.INTEREST) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-orange-600">
                        {y.TAX_WITHHOLD !== 0 ? fmt(Math.abs(y.TAX_WITHHOLD)) : "—"}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-semibold ${
                          net >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {fmt(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Détail par compte */}
      {yearData.map((y) =>
        y.byAccount.length > 0 ? (
          <Card key={y.year}>
            <CardHeader>
              <CardTitle className="text-base">{y.year} — par compte</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Compte</th>
                      <th className="px-4 py-2 text-right">Revenus bruts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {y.byAccount
                      .sort((a, b) => b.amount - a.amount)
                      .map((row) => (
                        <tr key={row.accountKey} className="hover:bg-slate-50">
                          <td className="px-4 py-2 text-slate-700">
                            {accountLabel(row.accountKey)}
                          </td>
                          <td
                            className={`px-4 py-2 text-right font-medium ${
                              row.amount >= 0 ? "text-emerald-700" : "text-rose-600"
                            }`}
                          >
                            {fmt(row.amount)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null,
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
  note,
}: {
  label: string;
  value: string;
  color: "sky" | "blue" | "orange";
  note?: string;
}) {
  const colorClass = {
    sky: "text-sky-700",
    blue: "text-blue-700",
    orange: "text-orange-600",
  }[color];

  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${colorClass}`}>{value}</p>
        {note && <p className="mt-1 text-xs text-slate-400">{note}</p>}
      </CardContent>
    </Card>
  );
}
