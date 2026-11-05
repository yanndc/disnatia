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

/** Libellé d'une ligne de totaux : « Total », « Total des actifs », « Vue d'ensemble »… */
const TOTAL_LABEL = /total|vue d['’]?ensemble/i;

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

/**
 * Montant d'une cellule. Disnat empile parfois deux devises dans la même cellule
 * (`230,92 CAD` puis `613,96 USD`) : on retient alors la **première** (devise du compte, CAD ici).
 */
function cellMoney(text: string): number | null {
  const whole = parseDisnatMoney(text);
  if (whole !== null) return whole;
  const [first] = extractMoneyValues(text);
  return first ?? null;
}

/** Totaux lus dans les cellules `<td>/<th>` d'un extrait (format historique). */
function totalsFromCells(chunk: string): DisnatSummaryTotals | null {
  const cells = [...chunk.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((match) => stripHtmlTags(match[1]))
    .filter((cell) => cell.length > 0);

  const numbers = cells
    .map((cell) => ({ text: cell, value: cellMoney(cell) }))
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
 * Lignes de totaux **libellées** (« Total », « Vue d'ensemble »…) qui vérifient l'identité
 * comptable, dans l'ordre du document. Une page « Tous les comptes » en contient une par client.
 */
export function parseDisnatSummaryRows(html: string): DisnatSummaryTotals[] {
  if (!html) return [];
  const rows: DisnatSummaryTotals[] = [];
  for (const rowMatch of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    const text = stripHtmlTags(rowHtml);
    if (!TOTAL_LABEL.test(text)) continue;
    const totals = totalsFromCells(rowHtml) ?? totalsFromText(text, false);
    if (totals) rows.push(totals);
  }
  return rows;
}

/**
 * Lit la ligne de totaux d'une page d'encaisse Disnat.
 *
 * Trois mises en page coexistent :
 * - agrégat historique : ligne `Total des actifs | 1.3977 | 1 527,54 CAD | …` ;
 * - vue d'ensemble d'un client : ligne `Total` en fin de tableau ;
 * - **« Mes comptes »** (écran `clientId=ALL`) : en-têtes *Liquidités / Valeur des titres /
 *   Valeur totale* et une ligne **`Vue d'ensemble`** par client (CAD empilé au-dessus du USD),
 *   sans le mot « total » — on la reconnaît à l'identité comptable.
 *
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

  // 2) Ligne libellée (« Vue d'ensemble », « Total »…) : première de la page.
  const labelled = parseDisnatSummaryRows(html);
  if (labelled.length > 0) return labelled[0];

  // 3) Page d'encaisse sans libellé exploitable : première ligne à identité comptable
  //    (CAD lu en premier quand deux devises sont empilées).
  if (!/liquidit[ée]s/i.test(html) || !/valeur totale/i.test(html)) return null;
  for (const rowMatch of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
    const totals = totalsFromCells(rowMatch[0]);
    if (totals) return totals;
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
 * Code client déduit du HTML de la page. On ne retient une valeur que si elle est **unique** :
 * - paramètre `clientId=…` des liens (hors `ALL`) ;
 * - **numéros de compte** : les 5 premiers caractères d'un compte (`5KFZEY4`) sont le code client
 *   propriétaire (`5KFZE`) — c'est ce qui identifie le client sur l'écran « Mes comptes ».
 * Plusieurs clients dans la page ⇒ `null` (le favori demande alors le code).
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

  for (const match of html.matchAll(/\b\d[A-Z0-9]{6}\b/g)) {
    const account = match[0];
    // Écarte les jetons purement numériques (dates condensées, identifiants techniques).
    if ((account.match(/[A-Z]/g) ?? []).length < 4) continue;
    codes.add(account.slice(0, 5));
    if (codes.size > 1) return null;
  }

  return codes.size === 1 ? [...codes][0] : null;
}
