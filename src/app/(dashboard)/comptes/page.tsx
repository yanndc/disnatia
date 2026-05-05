import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccountsWithStats } from "@/features/portfolio/queries";
import { getLatestUsdCadRate } from "@/lib/fx/latest-usd-cad-rate";
import { refreshUsdCadRatesIfStale } from "@/lib/fx/refresh-usd-cad-rates";
import { formatCurrency, formatNumber, normalizeCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

type AccountWithStats = Awaited<ReturnType<typeof getAccountsWithStats>>[number];

function sum(vals: number[]) {
  return vals.reduce((t, v) => t + v, 0);
}

export default async function ComptesPage() {
  const accounts: AccountWithStats[] = await getAccountsWithStats().catch(() => []);

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

  await refreshUsdCadRatesIfStale().catch(() => {});
  const fx = await getLatestUsdCadRate();
  const usdToCad = fx?.usdToCad ?? null;

  // Grouper par propriétaire
  const byOwner = new Map<string, AccountWithStats[]>();
  for (const acc of accounts) {
    const owner = acc.owner ?? "Propriétaire inconnu";
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push(acc);
  }

  const cadAccounts = accounts.filter((a) => normalizeCurrency(a.currency) === "CAD");
  const usdAccounts = accounts.filter((a) => normalizeCurrency(a.currency) === "USD");

  const cadEncaisse = sum(cadAccounts.map((a) => a.cashValue));
  const cadTitres = sum(cadAccounts.map((a) => a.marketValue));
  const cadTotal = sum(cadAccounts.map((a) => a.totalValue));

  const usdEncaisseUsd = sum(usdAccounts.map((a) => a.cashValue));
  const usdTitresUsd = sum(usdAccounts.map((a) => a.marketValue));
  const usdTotalUsd = sum(usdAccounts.map((a) => a.totalValue));

  const usdEncaisseCad = usdToCad != null ? usdEncaisseUsd * usdToCad : null;
  const usdTitresCad = usdToCad != null ? usdTitresUsd * usdToCad : null;
  const usdTotalCad = usdToCad != null ? usdTotalUsd * usdToCad : null;

  const consEncaisse =
    usdEncaisseCad != null ? cadEncaisse + usdEncaisseCad : null;
  const consTitres = usdTitresCad != null ? cadTitres + usdTitresCad : null;
  const consTotal = usdTotalCad != null ? cadTotal + usdTotalCad : null;

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm text-slate-500">Tableau de bord</p>
        <h2 className="text-2xl font-semibold text-slate-950">Comptes</h2>
        <p className="mt-1 text-sm text-slate-500">
          {accounts.length} compte{accounts.length > 1 ? "s" : ""} au total
        </p>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Totaux (équivalent CAD)
          </p>
          {usdToCad == null || fx == null ? (
            <p className="mt-2 text-sm text-amber-800">
              Taux USD→CAD indisponible : les montants consolidés en CAD ne peuvent pas être
              calculés. Les comptes en US restent affichés en dollars US seulement.
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              Taux du{" "}
              <time dateTime={fx.rateDate.toISOString().slice(0, 10)}>
                {fx.rateDate.toLocaleDateString("fr-CA")}
              </time>{" "}
              : 1 USD = {formatNumber(fx.usdToCad, 5)} CAD
            </p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="pb-2 pr-3 font-medium" />
                  <th className="pb-2 px-2 text-right font-medium">Encaisse</th>
                  <th className="pb-2 px-2 text-right font-medium">Titres</th>
                  <th className="pb-2 pl-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                <tr>
                  <td className="py-2 pr-3 font-medium text-slate-600">Comptes CAD</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatCurrency(cadEncaisse, "CAD")}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatCurrency(cadTitres, "CAD")}
                  </td>
                  <td className="pl-2 py-2 text-right tabular-nums font-medium">
                    {formatCurrency(cadTotal, "CAD")}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-slate-600">
                    Comptes USD
                    {usdToCad != null ? (
                      <span className="mt-0.5 block text-xs font-normal normal-case text-slate-400">
                        converti au taux du jour
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {usdEncaisseCad != null ? (
                      formatCurrency(usdEncaisseCad, "CAD")
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {usdTitresCad != null ? (
                      formatCurrency(usdTitresCad, "CAD")
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="pl-2 py-2 text-right tabular-nums font-medium">
                    {usdTotalCad != null ? (
                      formatCurrency(usdTotalCad, "CAD")
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
                <tr className="border-t border-slate-300 bg-white/70 font-semibold text-slate-950">
                  <td className="py-2 pr-3">Total en CAD</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {consEncaisse != null ? (
                      formatCurrency(consEncaisse, "CAD")
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {consTitres != null ? formatCurrency(consTitres, "CAD") : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="pl-2 py-2 text-right tabular-nums text-base">
                    {consTotal != null ? formatCurrency(consTotal, "CAD") : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
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
                  {ownerAccounts.map((acc) => {
                    const cur = normalizeCurrency(acc.currency);
                    const isUsd = cur === "USD" && usdToCad != null;
                    return (
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
                        <AmountCellUsdCad
                          amount={acc.cashValue}
                          currency={cur}
                          isUsd={isUsd}
                          usdToCad={usdToCad ?? 1}
                          showCad={isUsd}
                        />
                        <AmountCellUsdCad
                          amount={acc.marketValue}
                          currency={cur}
                          isUsd={isUsd}
                          usdToCad={usdToCad ?? 1}
                          showCad={isUsd}
                        />
                        <AmountCellUsdCad
                          amount={acc.totalValue}
                          currency={cur}
                          isUsd={isUsd}
                          usdToCad={usdToCad ?? 1}
                          showCad={isUsd}
                          emphasize
                        />
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
                        <td className="px-4 py-2 text-right text-xs text-slate-400">
                          {acc.lastTxDate
                            ? acc.lastTxDate.toLocaleDateString("fr-CA")
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AmountCellUsdCad(props: {
  amount: number;
  currency: string;
  isUsd: boolean;
  usdToCad: number;
  showCad: boolean;
  emphasize?: boolean;
}) {
  const { amount, currency, isUsd, usdToCad, showCad, emphasize } = props;
  const cadEq = amount * usdToCad;

  return (
    <td
      className={`px-4 py-2 text-right text-slate-700 ${emphasize ? "font-semibold text-slate-950" : ""}`}
    >
      <div>{formatCurrency(amount, currency)}</div>
      {isUsd && showCad ? (
        <div className="mt-0.5 text-xs font-normal text-slate-500">
          ≈ {formatCurrency(cadEq, "CAD")}
        </div>
      ) : null}
      {currency === "USD" && !showCad ? (
        <div className="mt-0.5 text-xs text-slate-400">Taux CAD indispo.</div>
      ) : null}
    </td>
  );
}
