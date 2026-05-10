import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshQuotesButton } from "@/features/portfolio/refresh-quotes-button";
import { listExternalAccountsWithLatest } from "@/features/portfolio/external-accounts-queries";
import { getAccountsWithStats } from "@/features/portfolio/queries";
import { getLatestUsdCadRate } from "@/lib/fx/latest-usd-cad-rate";
import { refreshUsdCadRatesIfStale } from "@/lib/fx/refresh-usd-cad-rates";
import { EXTERNAL_ACCOUNT_PROVIDERS } from "@/lib/portfolio/external-account-providers";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";
import { formatCurrency, formatNumber, normalizeCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

type AccountWithStats = Awaited<ReturnType<typeof getAccountsWithStats>>[number];

function sum(vals: number[]) {
  return vals.reduce((t, v) => t + v, 0);
}

function accountDriftTitresCad(
  acc: AccountWithStats,
  usdToCad: number | null,
): number | null {
  if (acc.driftTitresVsSnapshot === null) return null;
  const cur = normalizeCurrency(acc.currency);
  if (cur === "USD") return usdToCad != null ? acc.driftTitresVsSnapshot * usdToCad : null;
  return acc.driftTitresVsSnapshot;
}

/** Titre de carte : propriétaire réel, sinon une ligne par devise pour éviter un seul bloc géant. */
function ownerSectionTitle(acc: AccountWithStats): string {
  const named = sanitizePortfolioOwner(acc.owner);
  if (named) return named;
  return `Propriétaire inconnu (${normalizeCurrency(acc.currency)})`;
}

/** Agrège les comptes d’un même propriétaire pour une devise (lignes récap type Disnat). */
function aggregateByCurrency(accounts: AccountWithStats[], currency: "CAD" | "USD") {
  const subset = accounts.filter((a) => normalizeCurrency(a.currency) === currency);
  let reconMissing = false;
  let driftMissing = false;
  let reconSum = 0;
  let driftSum = 0;
  for (const a of subset) {
    if (a.reconstructedMarketValue === null) reconMissing = true;
    else reconSum += a.reconstructedMarketValue;
    if (a.driftTitresVsSnapshot === null) driftMissing = true;
    else driftSum += a.driftTitresVsSnapshot;
  }
  return {
    subset,
    cash: sum(subset.map((a) => a.cashValue)),
    market: sum(subset.map((a) => a.marketValue)),
    total: sum(subset.map((a) => a.totalValue)),
    reconstructedMarketValue: reconMissing ? null : reconSum,
    driftTitresVsSnapshot: driftMissing ? null : driftSum,
    txCount: sum(subset.map((a) => a.txCount)),
    lastTxDate: subset.reduce<Date | null>((latest, a) => {
      const d = a.lastTxDate;
      if (!d) return latest;
      if (!latest || d.getTime() > latest.getTime()) return d;
      return latest;
    }, null),
  };
}

function ownerDriftNetCad(
  accounts: AccountWithStats[],
  usdToCad: number | null,
): number | null {
  const parts = accounts
    .map((a) => accountDriftTitresCad(a, usdToCad))
    .filter((v): v is number => v !== null);
  return parts.length > 0 ? sum(parts) : null;
}

function ownerConsolidatedCad(
  accounts: AccountWithStats[],
  usdToCad: number | null,
): {
  encaisse: number | null;
  titresFichier: number | null;
  titresRecon: number | null;
  total: number | null;
} {
  if (usdToCad == null) {
    return {
      encaisse: null,
      titresFichier: null,
      titresRecon: null,
      total: null,
    };
  }
  let reconMissing = false;
  let enc = 0;
  let mkt = 0;
  let tot = 0;
  let recon = 0;
  for (const a of accounts) {
    const cur = normalizeCurrency(a.currency);
    const mult = cur === "USD" ? usdToCad : 1;
    enc += a.cashValue * mult;
    mkt += a.marketValue * mult;
    tot += a.totalValue * mult;
    if (a.reconstructedMarketValue === null) reconMissing = true;
    else recon += a.reconstructedMarketValue * mult;
  }
  return {
    encaisse: enc,
    titresFichier: mkt,
    titresRecon: reconMissing ? null : recon,
    total: tot,
  };
}

function driftCellClass(drift: number | null) {
  if (drift === null) return "text-slate-400";
  return Math.abs(drift) > 500 ? "font-medium text-amber-700" : "text-slate-700";
}

/** Pied de tableau par personne : sous-totaux CAD / USD (style synthèse Disnat) + total équivalent CAD si pertinent. */
function OwnerAccountsTableFooter({
  ownerAccounts,
  usdToCad,
}: {
  ownerAccounts: AccountWithStats[];
  usdToCad: number | null;
}) {
  const cadAgg = aggregateByCurrency(ownerAccounts, "CAD");
  const usdAgg = aggregateByCurrency(ownerAccounts, "USD");
  const hasCad = cadAgg.subset.length > 0;
  const hasUsd = usdAgg.subset.length > 0;
  const showSplit = hasCad && hasUsd;
  const cons = ownerConsolidatedCad(ownerAccounts, usdToCad);
  const driftNetCad = ownerDriftNetCad(ownerAccounts, usdToCad);
  const rowMuted = "border-t border-slate-200 bg-slate-50/90 font-medium text-slate-900";
  const rowTotal =
    "border-t-2 border-slate-300 bg-white/80 font-semibold text-slate-950";

  function subtotalRow(
    label: string,
    agg: ReturnType<typeof aggregateByCurrency>,
    currency: "CAD" | "USD",
  ) {
    if (agg.subset.length === 0) return null;
    const cur = currency;
    const isUsd = cur === "USD" && usdToCad != null;
    const rate = usdToCad ?? 1;
    return (
      <tr key={`sub-${currency}`} className={rowMuted}>
        <td className="px-4 py-2 text-slate-800">{label}</td>
        <td className="px-4 py-2 font-mono text-slate-400">—</td>
        <td className="px-4 py-2">
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
            {currency}
          </span>
        </td>
        <AmountCellUsdCad
          amount={agg.cash}
          currency={cur}
          isUsd={isUsd}
          usdToCad={rate}
          showCad={isUsd}
        />
        <AmountCellUsdCad
          amount={agg.market}
          currency={cur}
          isUsd={isUsd}
          usdToCad={rate}
          showCad={isUsd}
        />
        <td className="px-4 py-2 text-right tabular-nums text-slate-700">
          {agg.reconstructedMarketValue === null ? (
            <span className="text-slate-400">—</span>
          ) : (
            formatCurrency(agg.reconstructedMarketValue, cur)
          )}
        </td>
        <td className={`px-4 py-2 text-right tabular-nums ${driftCellClass(agg.driftTitresVsSnapshot)}`}>
          {agg.driftTitresVsSnapshot === null ? (
            "—"
          ) : (
            <>
              {agg.driftTitresVsSnapshot > 0 ? "+" : ""}
              {formatCurrency(agg.driftTitresVsSnapshot, cur)}
            </>
          )}
        </td>
        <AmountCellUsdCad
          amount={agg.total}
          currency={cur}
          isUsd={isUsd}
          usdToCad={rate}
          showCad={isUsd}
          emphasize
        />
        <td className="px-4 py-2 text-right tabular-nums text-slate-600">{agg.txCount}</td>
        <td className="px-4 py-2 text-right text-xs text-slate-500">
          {agg.lastTxDate ? agg.lastTxDate.toLocaleDateString("fr-CA") : "—"}
        </td>
      </tr>
    );
  }

  const rows: ReactNode[] = [];

  if (showSplit) {
    const rowCad = subtotalRow("Sous-total · comptes CAD", cadAgg, "CAD");
    const rowUsd = subtotalRow("Sous-total · comptes USD", usdAgg, "USD");
    if (rowCad) rows.push(rowCad);
    if (rowUsd) rows.push(rowUsd);
    if (usdToCad != null && cons.encaisse != null) {
      rows.push(
        <tr key="consolidated" className={rowTotal}>
          <td className="px-4 py-2">
            Total portefeuille
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              équivalent CAD (taux du jour)
            </span>
          </td>
          <td className="px-4 py-2 font-mono text-slate-400">—</td>
          <td className="px-4 py-2">
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
              CAD
            </span>
          </td>
          <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-950">
            {formatCurrency(cons.encaisse, "CAD")}
          </td>
          <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-950">
            {formatCurrency(cons.titresFichier!, "CAD")}
          </td>
          <td className="px-4 py-2 text-right tabular-nums">
            {cons.titresRecon === null ? (
              <span className="text-slate-400">—</span>
            ) : (
              formatCurrency(cons.titresRecon, "CAD")
            )}
          </td>
          <td
            className={`px-4 py-2 text-right tabular-nums ${driftCellClass(driftNetCad)}`}
          >
            {driftNetCad === null ? (
              "—"
            ) : (
              <>
                {driftNetCad > 0 ? "+" : ""}
                {formatCurrency(driftNetCad, "CAD")}
              </>
            )}
          </td>
          <td className="px-4 py-2 text-right tabular-nums text-base font-semibold text-slate-950">
            {formatCurrency(cons.total!, "CAD")}
          </td>
          <td className="px-4 py-2 text-right tabular-nums text-slate-600">
            {sum(ownerAccounts.map((a) => a.txCount))}
          </td>
          <td className="px-4 py-2 text-right text-xs text-slate-500">
            {ownerAccounts.reduce<Date | null>((latest, a) => {
              const d = a.lastTxDate;
              if (!d) return latest;
              if (!latest || d.getTime() > latest.getTime()) return d;
              return latest;
            }, null)?.toLocaleDateString("fr-CA") ?? "—"}
          </td>
        </tr>,
      );
    }
  } else if (hasCad) {
    const row = subtotalRow("Total (CAD)", cadAgg, "CAD");
    if (row) rows.push(row);
  } else if (hasUsd) {
    const row = subtotalRow("Total (USD)", usdAgg, "USD");
    if (row) rows.push(row);
  }

  if (rows.length === 0) return null;

  return <tfoot>{rows}</tfoot>;
}

export default async function ComptesPage() {
  const [accounts, externalAccounts] = await Promise.all([
    getAccountsWithStats().catch(() => []),
    listExternalAccountsWithLatest().catch(() => []),
  ]);

  if (accounts.length === 0 && externalAccounts.length === 0) {
    return (
      <Card>
        <CardContent className="flex min-h-80 flex-col items-center justify-center text-center">
          <h2 className="text-xl font-semibold text-slate-950">Aucun compte connu</h2>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            Importez d&apos;abord le fichier CSV Portefeuille depuis Disnat pour identifier vos
            comptes (CELI, REER, CRI…), ou ajoutez un{" "}
            <Link href="/imports" className="underline-offset-2 hover:underline">
              compte externe
            </Link>{" "}
            (REER collectif, autre assureur) avec des snapshots manuels.
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

  const externalAccountsSection =
    externalAccounts.length > 0 ? (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comptes hors Disnat</CardTitle>
          <p className="text-sm text-slate-500">
            Snapshots de valeur saisis sur la page{" "}
            <Link href="/imports" className="text-violet-700 underline-offset-2 hover:underline">
              Imports
            </Link>
            .
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Libellé</th>
                  <th className="px-4 py-2">Propriétaire</th>
                  <th className="px-4 py-2">Source</th>
                  <th className="px-4 py-2">Devise</th>
                  <th className="px-4 py-2 text-right">Solde (snapshot)</th>
                  <th className="px-4 py-2 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {externalAccounts.map((ex) => (
                  <tr key={ex.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-800">{ex.displayLabel}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {ex.owner?.trim()
                        ? (sanitizePortfolioOwner(ex.owner) ?? ex.owner.trim())
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {EXTERNAL_ACCOUNT_PROVIDERS.find((p) => p.id === ex.provider)?.label ??
                        ex.provider}
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {ex.currency}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {ex.latestSnapshot
                        ? formatCurrency(ex.latestSnapshot.totalValue, ex.currency)
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-500">
                      {ex.latestSnapshot
                        ? ex.latestSnapshot.asOfDate.toLocaleDateString("fr-CA")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Pas de synchronisation automatique avec l&apos;assureur — chaque point correspond à une
            valeur lue sur ton espace sécurisé.
          </p>
        </CardContent>
      </Card>
    ) : null;

  if (accounts.length === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="flex min-h-40 flex-col items-center justify-center py-8 text-center">
            <h2 className="text-lg font-semibold text-slate-950">Comptes Disnat</h2>
            <p className="mt-2 max-w-md text-sm text-slate-500">
              Importe le CSV portefeuille Disnat pour voir le détail encaisse / titres / écarts par
              compte.
            </p>
            <Link
              href="/imports"
              className="mt-4 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Vers les imports
            </Link>
          </CardContent>
        </Card>
        {externalAccountsSection}
      </div>
    );
  }

  await refreshUsdCadRatesIfStale().catch(() => {});
  const fx = await getLatestUsdCadRate();
  const usdToCad = fx?.usdToCad ?? null;

  // Grouper par propriétaire (sans nom → une carte par devise)
  const byOwner = new Map<string, AccountWithStats[]>();
  for (const acc of accounts) {
    const section = ownerSectionTitle(acc);
    if (!byOwner.has(section)) byOwner.set(section, []);
    byOwner.get(section)!.push(acc);
  }

  const ownerSectionsSorted = [...byOwner.entries()].sort(([a], [b]) =>
    a.localeCompare(b, "fr-CA"),
  );

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

  const driftParts = accounts
    .map((a) => ({
      acc: a,
      driftCad: accountDriftTitresCad(a, usdToCad),
    }))
    .filter((row): row is { acc: AccountWithStats; driftCad: number } => row.driftCad !== null);
  const driftNetCad = driftParts.length > 0 ? sum(driftParts.map((p) => p.driftCad)) : null;
  const driftSumAbs =
    driftParts.length > 0 ? sum(driftParts.map((p) => Math.abs(p.driftCad))) : null;
  const driftSorted = driftParts.toSorted(
    (a, b) => Math.abs(b.driftCad) - Math.abs(a.driftCad),
  );
  const driftTop = driftSorted[0];
  const driftTopShareAbs =
    driftTop && driftSumAbs != null && driftSumAbs > 0
      ? (Math.abs(driftTop.driftCad) / driftSumAbs) * 100
      : null;
  const singleDominant =
    driftTopShareAbs != null && driftTopShareAbs >= 85 && driftTop != null;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">Tableau de bord</p>
            <h2 className="text-2xl font-semibold text-slate-950">Comptes</h2>
            <p className="mt-1 text-sm text-slate-500">
              {accounts.length} compte{accounts.length > 1 ? "s" : ""} ·{" "}
              <strong className="font-medium text-slate-700">Écart titres</strong> = titres
              projetés depuis les opérations (+ cours) − valeur titres du fichier portefeuille Disnat.
            </p>
          </div>
          <RefreshQuotesButton />
        </div>

        {driftNetCad !== null && usdToCad != null ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
            <p>
              <span className="text-slate-500">Écart titres net (CAD) : </span>
              <span className="font-semibold tabular-nums text-slate-900">
                {driftNetCad > 0 ? "+" : ""}
                {formatCurrency(driftNetCad, "CAD")}
              </span>
            </p>
            {driftTop ? (
              <p className="mt-1 text-xs text-slate-600">
                Plus gros écart :{" "}
                <span className="font-mono text-slate-800">
                  {driftTop.acc.accountNumber ?? driftTop.acc.accountKey}
                </span>{" "}
                ({driftTop.acc.accountType ?? "—"}, {driftTop.acc.currency}) →{" "}
                <span className="tabular-nums font-medium">
                  {driftTop.driftCad > 0 ? "+" : ""}
                  {formatCurrency(driftTop.driftCad, "CAD")}
                </span>
                {driftTopShareAbs != null ? (
                  <>
                    {" "}
                    · {formatNumber(driftTopShareAbs, 0)} % des écarts (valeur absolue)
                  </>
                ) : null}
                {singleDominant ? (
                  <span className="ml-1 font-medium text-amber-800">
                    — presque tout vient de ce compte.
                  </span>
                ) : driftTopShareAbs != null && driftTopShareAbs < 85 ? (
                  <span className="ml-1 text-slate-500">— plusieurs comptes comptent.</span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : driftNetCad === null && accounts.some((a) => a.driftTitresVsSnapshot !== null) ? (
          <p className="mt-2 text-xs text-amber-800">
            Taux USD→CAD manquant : écart total en CAD non calculable.
          </p>
        ) : null}

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
                  <th
                    className="pb-2 px-2 text-right font-medium"
                    title="Référence import portefeuille"
                  >
                    Encaisse (réf.)
                  </th>
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

      {ownerSectionsSorted.map(([owner, ownerAccounts]) => (
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
                    <th className="px-4 py-2 text-right" title="Dernier import portefeuille — référence réconciliation">
                      Encaisse (réf.)
                    </th>
                    <th className="px-4 py-2 text-right">Titres (fichier)</th>
                    <th className="px-4 py-2 text-right">Titres reconstr.</th>
                    <th className="px-4 py-2 text-right">Écart titres</th>
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
                        <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                          {acc.reconstructedMarketValue === null ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            formatCurrency(acc.reconstructedMarketValue, cur)
                          )}
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums ${
                            acc.driftTitresVsSnapshot === null
                              ? "text-slate-400"
                              : Math.abs(acc.driftTitresVsSnapshot) > 500
                                ? "font-medium text-amber-700"
                                : "text-slate-700"
                          }`}
                        >
                          {acc.driftTitresVsSnapshot === null ? (
                            "—"
                          ) : (
                            <>
                              {acc.driftTitresVsSnapshot > 0 ? "+" : ""}
                              {formatCurrency(acc.driftTitresVsSnapshot, cur)}
                            </>
                          )}
                        </td>
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
                <OwnerAccountsTableFooter
                  ownerAccounts={ownerAccounts}
                  usdToCad={usdToCad}
                />
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
      {externalAccountsSection}
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
