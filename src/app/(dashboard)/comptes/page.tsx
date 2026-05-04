import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccountsWithStats } from "@/features/portfolio/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ComptesPage() {
  const accounts = await getAccountsWithStats().catch(() => []);

  if (accounts.length === 0) {
    return (
      <Card>
        <CardContent className="flex min-h-80 flex-col items-center justify-center text-center">
          <h2 className="text-xl font-semibold text-slate-950">Aucun compte connu</h2>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            Importez d&apos;abord le fichier CSV Portefeuille depuis Disnat pour identifier vos
            comptes (CELI, REER, CRI…).
          </p>
          <Link
            href="/imports"
            className="mt-5 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Importer un fichier
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Grouper par propriétaire
  const byOwner = new Map<string, typeof accounts>();
  for (const acc of accounts) {
    const owner = acc.owner ?? "Propriétaire inconnu";
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push(acc);
  }

  const totalCad = accounts
    .filter((a) => a.currency === "CAD")
    .reduce((s, a) => s + a.totalValue, 0);
  const totalUsd = accounts
    .filter((a) => a.currency === "USD")
    .reduce((s, a) => s + a.totalValue, 0);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm text-slate-500">Tableau de bord</p>
        <h2 className="text-2xl font-semibold text-slate-950">Comptes</h2>
        <p className="mt-1 text-sm text-slate-500">
          {accounts.length} compte{accounts.length > 1 ? "s" : ""} ·{" "}
          {formatCurrency(totalCad, "CAD")} CAD · {formatCurrency(totalUsd, "USD")} USD
        </p>
      </section>

      {Array.from(byOwner.entries()).map(([owner, ownerAccounts]) => (
        <Card key={owner}>
          <CardHeader>
            <CardTitle className="text-base">{owner}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">N° compte</th>
                    <th className="px-4 py-2">Devise</th>
                    <th className="px-4 py-2 text-right">Encaisse</th>
                    <th className="px-4 py-2 text-right">Titres</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-right">Transactions</th>
                    <th className="px-4 py-2 text-right">Dernière op.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ownerAccounts.map((acc) => (
                    <tr key={acc.accountKey} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-800">
                        {acc.accountType ?? "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-slate-600">
                        {acc.accountNumber ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {acc.currency}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-slate-700">
                        {formatCurrency(acc.cashValue, acc.currency)}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-700">
                        {formatCurrency(acc.marketValue, acc.currency)}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-950">
                        {formatCurrency(acc.totalValue, acc.currency)}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-500">
                        {acc.txCount > 0 ? (
                          <Link
                            href={`/transactions?accountKey=${encodeURIComponent(acc.accountKey)}`}
                            className="text-slate-700 underline-offset-2 hover:underline"
                          >
                            {acc.txCount}
                          </Link>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-400 text-xs">
                        {acc.lastTxDate
                          ? acc.lastTxDate.toLocaleDateString("fr-CA")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
