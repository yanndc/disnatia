/**
 * Montre début / fin / Δ pour la séance — et pourquoi Δ ≠ fin − début global si les bases diffèrent.
 */
import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { loadHoldingsForDashboard } from "@/features/portfolio/holdings-display-query";
import { priorSessionCloseByPair } from "@/features/portfolio/daily-close-prices";
import { normalizeCurrency } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

function toCad(v: number, cur: string, fx: number | null) {
  return normalizeCurrency(cur) === "USD" && fx ? v * fx : v;
}

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const fx = payload.usdToCad;
  const keys = payload.accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);
  const states = await prisma.portfolioAccountState.findMany();

  let fin = 0;
  let debutApp = 0;
  let gainApp = 0;
  let debutImport = 0;

  console.log("=== Par compte (titres seulement, CAD) ===\n");
  console.log(
    "Compte".padEnd(14),
    "Fin (live)".padStart(12),
    "Début (clôture veille BD)".padStart(22),
    "Δ séance".padStart(12),
    "Fin−Début".padStart(12),
    "Import titres".padStart(14),
  );

  for (const k of keys) {
    const c = payload.currentByAccount[k];
    const st = states.find((s) => s.accountKey === k);
    if (!c || c.positionsCad <= 0) continue;
    const d = c.dayPriorCad ?? 0;
    const g = c.dayGainCad ?? 0;
    const imp = st ? toCad(st.marketValue, st.currency, fx) : 0;
    fin += c.positionsCad;
    debutApp += d;
    gainApp += g;
    debutImport += imp;
    const check = c.positionsCad - d;
    console.log(
      k.slice(0, 13).padEnd(14),
      fmt(c.positionsCad).padStart(12),
      fmt(d).padStart(22),
      fmt(g).padStart(12),
      fmt(check).padStart(12),
      fmt(imp).padStart(14),
    );
    if (Math.abs(check - g) > 1) {
      console.log("  ⚠ Δ ≠ fin−début sur ce compte");
    }
    if (Math.abs(d - imp) > 50) {
      console.log(
        `  ⚠ Début BD vs import Disnat: écart ${fmt(d - imp)} (pas utilisé dans le calcul)`,
      );
    }
  }

  console.log("\n=== Totaux ===");
  console.log("Fin (Σ titres live):     ", fmt(fin));
  console.log("Début (Σ clôture veille):", fmt(debutApp));
  console.log("Δ séance (Σ lignes):     ", fmt(gainApp));
  console.log("Fin − Début (global):    ", fmt(fin - debutApp));
  console.log("Import Disnat Σ titres:  ", fmt(debutImport), "(référence fichier seulement)");
  console.log("Δ si début = import:    ", fmt(fin - debutImport), "(proche écran Disnat ~-1163)");

  const holdings = await loadHoldingsForDashboard();
  const pairs = [
    ...new Map(
      holdings.map((h) => [
        `${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`,
        { ticker: h.ticker.toUpperCase(), currency: normalizeCurrency(h.currency) },
      ]),
    ).values(),
  ];
  const priorMap = await priorSessionCloseByPair(pairs);

  let debutFromCloses = 0;
  for (const h of holdings) {
    if (h.quantity <= 0) continue;
    const pk = `${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`;
    const prior = priorMap.get(pk);
    if (prior == null) continue;
    debutFromCloses += toCad(h.quantity * prior, h.currency, fx);
  }
  console.log("\nDébut recalculé Σ qty×clôture_veille BD:", fmt(debutFromCloses));
  console.log("Écart vs dayPriorCad agrégé:           ", fmt(debutApp - debutFromCloses));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
