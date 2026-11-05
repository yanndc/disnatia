export type DisnatSummaryTotals = {
  /** Taux (« Taux » colonne 1) — informatif. */
  rate: number | null;
  cashCad: number;
  securitiesCad: number;
  totalCad: number;
};

/** Montant « 1 527,54 CAD » / « 247 530,27 » → nombre. */
export function parseDisnatMoney(value: string): number | null {
  const cleaned = value
    .replace(/\u00a0/g, " ")
    .replace(/\s*CAD\s*/gi, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Texte lisible d'un fragment HTML (balises retirées, espaces normalisés). */
export function stripHtmlTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Montants d'un texte : « 1 527,54 », « 247 530,27 CAD », « -520,00 ».
 * On exige **deux décimales** pour ignorer les numéros de compte, les dates et
 * les taux de change (`1.3977`), qui casseraient l'identité comptable.
 */
const MONEY_TOKEN =
  /-?\d{1,3}(?:[ \u00a0\u202f]\d{3})*[.,]\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g;

export function extractMoneyValues(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(MONEY_TOKEN)) {
    const value = parseDisnatMoney(match[0]);
    if (value !== null) values.push(value);
  }
  return values;
}

/** Libellé de la ligne de totaux d'une « Vue d'ensemble ». */
const TOTAL_LABEL = /total/i;

type Triplet = { index: number; cashCad: number; securitiesCad: number; totalCad: number };

/**
 * Identité comptable : encaisse + titres = valeur totale. Elle identifie le bon triplet
 * même quand la ligne contient d'autres montants (gain/perte, variation, marge…).
 */
function findTotalsTriplet(values: number[]): Triplet | null {
  for (let index = 0; index + 2 < values.length; index += 1) {
    const [cashCad, securitiesCad, totalCad] = [
      values[index],
      values[index + 1],
      values[index + 2],
    ];
    if (Math.abs(cashCad + securitiesCad - totalCad) > 1) continue;
    return { index, cashCad, securitiesCad, totalCad };
  }
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toTotals(triplet: Triplet, rate: number | null): DisnatSummaryTotals {
  return {
    rate,
    cashCad: round2(triplet.cashCad),
    securitiesCad: round2(triplet.securitiesCad),
    totalCad: round2(triplet.totalCad),
  };
}

/** Totaux lus dans les cellules `<td>/<th>` d'un extrait (format historique). */
function totalsFromCells(chunk: string): DisnatSummaryTotals | null {
  const cells = [...chunk.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((match) => stripHtmlTags(match[1]))
    .filter((cell) => cell.length > 0);

  const numbers = cells
    .map((cell) => ({ text: cell, value: parseDisnatMoney(cell) }))
    .filter((entry) => entry.value !== null) as { text: string; value: number }[];
  const triplet = findTotalsTriplet(numbers.map((entry) => entry.value));
  if (!triplet) return null;
  const rateCells = numbers.slice(0, triplet.index).filter((entry) => !/CAD/i.test(entry.text));
  return toTotals(triplet, rateCells.length > 0 ? rateCells[rateCells.length - 1].value : null);
}

/** Totaux lus dans un texte libre (cellules en `<div>`/`<span>`, pas de `<td>`). */
function totalsFromText(text: string, labelled: boolean): DisnatSummaryTotals | null {
  if (labelled && !TOTAL_LABEL.test(text)) return null;
  const triplet = findTotalsTriplet(extractMoneyValues(text));
  return triplet ? toTotals(triplet, null) : null;
}

/**
 * Lit la ligne de totaux d'une page « Vue d'ensemble » Disnat.
 *
 * Deux mises en page existent selon la portée choisie :
 * - tous les clients (agrégat) : ligne `Total des actifs | 1.3977 | 1 527,54 CAD | …` ;
 * - **un seul client** : tableau des comptes terminé par une simple ligne `Total`.
 * La page ne contient pas le détail par transaction : on rattache ces totaux au **client**
 * (`clientId` de l'URL) pour alimenter l'encaisse aux bornes.
 */
export function parseDisnatSummaryHtml(html: string): DisnatSummaryTotals | null {
  if (!html) return null;

  // 1) Format historique : la ligne « Total des actifs » sert d'ancre.
  const marker = html.search(/Total des actifs/i);
  if (marker >= 0) {
    const chunk = html.slice(marker, marker + 6000);
    const fromCells = totalsFromCells(chunk);
    if (fromCells) return fromCells;
    // Cellules rendues en `<div>` (grille React) : on lit le texte de la ligne.
    const rowEnd = chunk.indexOf("</tr>");
    const fromText = totalsFromText(
      stripHtmlTags(rowEnd > 0 ? chunk.slice(0, rowEnd) : chunk.slice(0, 1200)),
      false,
    );
    if (fromText) return fromText;
  }

  // 2) « Vue d'ensemble » d'un client seul : ligne « Total » (ou « Total des comptes »…).
  for (const rowMatch of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
    const text = stripHtmlTags(rowMatch[0]);
    if (!TOTAL_LABEL.test(text)) continue;
    const fromCells = totalsFromCells(rowMatch[0]);
    if (fromCells) return fromCells;
    const fromText = totalsFromText(text, false);
    if (fromText) return fromText;
  }

  return null;
}

/** Code client depuis l'URL Disnat (`clientId=5KFZE`), `ALL` sinon. */
export function clientCodeFromDisnatUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const clientId = parsed.searchParams.get("clientId")?.trim().toUpperCase();
    if (!clientId || clientId === "ALL") return null;
    return /^[A-Z0-9]{4,8}$/.test(clientId) ? clientId : null;
  } catch {
    return null;
  }
}

/**
 * Code client déduit du HTML de la page : repli quand le favori n'envoie pas d'URL
 * (favori généré avant l'ajout du champ `url`). On ne retient le code que s'il est
 * **unique** dans la page — sinon la portée reste ambiguë (vue « Tous les comptes »).
 */
export function clientCodeFromDisnatHtml(html: string): string | null {
  if (!html) return null;
  const codes = new Set<string>();
  for (const match of html.matchAll(/clientId=([A-Za-z0-9]{4,8})\b/g)) {
    const code = match[1].toUpperCase();
    if (code === "ALL") continue;
    codes.add(code);
    if (codes.size > 1) return null;
  }
  return codes.size === 1 ? [...codes][0] : null;
}
