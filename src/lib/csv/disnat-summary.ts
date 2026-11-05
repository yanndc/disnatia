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
 * Montant d'une cellule. Disnat empile deux devises dans la même cellule
 * (`230,92 CAD` puis `613,96 USD`) : on renvoie la valeur **en CAD**, en convertissant la
 * seconde ligne avec le taux de la page (`usdCadRate`).
 */
function cellMoney(text: string, usdCadRate: number | null): number | null {
  const values = extractMoneyValues(text);
  if (values.length >= 2 && usdCadRate && usdCadRate > 0) {
    return values[0] + values[1] * usdCadRate;
  }
  if (values.length >= 2) return values[0];
  return parseDisnatMoney(text) ?? values[0] ?? null;
}

/** Totaux lus dans les cellules `<td>/<th>` d'un extrait (format historique). */
function totalsFromCells(chunk: string, usdCadRate: number | null): DisnatSummaryTotals | null {
  const cells = [...chunk.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((match) => stripHtmlTags(match[1]))
    .filter((cell) => cell.length > 0);

  const numbers = cells
    .map((cell) => ({ text: cell, value: cellMoney(cell, usdCadRate) }))
    .filter((entry) => entry.value !== null) as { text: string; value: number }[];
  const triplet = findTotalsTriplet(numbers.map((entry) => entry.value));
  if (!triplet) return null;
  const rateCells = numbers.slice(0, triplet.index).filter((entry) => !/CAD|USD/i.test(entry.text));
  return toTotals(triplet, rateCells.length > 0 ? rateCells[rateCells.length - 1].value : null);
}

/** Totaux lus dans un texte libre (cellules en `<div>`/`<span>`, pas de `<td>`). */
function totalsFromText(text: string, labelled: boolean): DisnatSummaryTotals | null {
  if (labelled && !TOTAL_LABEL.test(text)) return null;
  const triplet = findTotalsTriplet(extractMoneyValues(text));
  return triplet ? toTotals(triplet, null) : null;
}

/** Ligne de totaux avec sa position dans le document. */
type LabelledTotalsRow = { totals: DisnatSummaryTotals; index: number };

function labelledTotalsRows(html: string, usdCadRate: number | null): LabelledTotalsRow[] {
  const rows: LabelledTotalsRow[] = [];
  for (const rowMatch of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    const text = stripHtmlTags(rowHtml);
    if (!TOTAL_LABEL.test(text)) continue;
    const totals = totalsFromCells(rowHtml, usdCadRate) ?? totalsFromText(text, false);
    if (totals) rows.push({ totals, index: rowMatch.index ?? 0 });
  }
  return rows;
}

/**
 * Lignes de totaux **libellées** (« Total », « Vue d'ensemble »…) qui vérifient l'identité
 * comptable, dans l'ordre du document. Une page « Tous les comptes » en contient une par client.
 * `usdCadRate` convertit la seconde ligne (USD) des cellules empilées.
 */
export function parseDisnatSummaryRows(
  html: string,
  usdCadRate: number | null = null,
): DisnatSummaryTotals[] {
  return labelledTotalsRows(html, usdCadRate).map((row) => row.totals);
}

export type DisnatSummaryScope = {
  totals: DisnatSummaryTotals;
  /**
   * Titulaire affiché au-dessus de la ligne de totaux (en-tête `row-label` du tableau).
   * `null` = vue **agrégée** « tous les comptes » (le total couvre alors plusieurs clients).
   */
  clientName: string | null;
};

/**
 * Répertoire « NOM - CODE » fourni par la liste « Compte » de Disnat
 * (`<optgroup label="YANN DE CHAMPLAIN - 5KFZE">`) : c'est ce qui permet de rattacher
 * chaque bloc de totaux à son client sans deviner.
 */
export function disnatClientDirectory(html: string): Map<string, string> {
  const directory = new Map<string, string>();
  for (const match of html.matchAll(/<optgroup[^>]*\blabel="([^"]*)"/gi)) {
    const label = stripHtmlTags(match[1]).toUpperCase();
    const parts = label.match(/^(.*?)\s*[-–]\s*([A-Z0-9]{4,8})$/);
    if (!parts) continue;
    const name = parts[1].trim();
    if (name) directory.set(name, parts[2]);
  }
  return directory;
}

/** Neutralise les listes « Compte » (les noms y figurent aussi) sans décaler les index. */
function maskSelects(html: string): string {
  return html
    .replace(/<select[\s\S]*?<\/select>/gi, (block) => " ".repeat(block.length))
    .replace(/<optgroup[\s\S]*?<\/optgroup>/gi, (block) => " ".repeat(block.length))
    .replace(/<option[\s\S]*?<\/option>/gi, (block) => " ".repeat(block.length));
}

/**
 * Titulaire affiché au-dessus de la ligne de totaux :
 * 1. cellule `th.row-label` du tableau (« Détail du compte ») ;
 * 2. à défaut, nom de client le plus proche **avant** la ligne (titre du bloc), en ignorant
 *    les `<select>` de la liste « Compte » qui contiennent tous les noms.
 */
function scopeNameBefore(html: string, index: number, directory: Map<string, string>): string | null {
  const head = html.lastIndexOf("<thead", index);
  if (head >= 0) {
    const cell = html.slice(head, index).match(/<th[^>]*row-label[^>]*>([\s\S]*?)<\/th>/i);
    const label = cell ? stripHtmlTags(cell[1]).toUpperCase() : "";
    if (label && directory.has(label)) return label;
  }

  const window = maskSelects(html.slice(Math.max(0, index - 4000), index)).toUpperCase();
  let best: { name: string; at: number } | null = null;
  for (const name of directory.keys()) {
    const at = window.lastIndexOf(name);
    if (at >= 0 && at > (best?.at ?? -1)) best = { name, at };
  }
  return best?.name ?? null;
}

/** Lignes de totaux avec le titulaire affiché (nom → code via `disnatClientDirectory`). */
export function parseDisnatSummaryScopes(
  html: string,
  usdCadRate: number | null = null,
): DisnatSummaryScope[] {
  const directory = disnatClientDirectory(html);
  return labelledTotalsRows(html, usdCadRate).map((row) => ({
    totals: row.totals,
    clientName: scopeNameBefore(html, row.index, directory),
  }));
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
export function parseDisnatSummaryHtml(
  html: string,
  usdCadRate: number | null = null,
): DisnatSummaryTotals | null {
  if (!html) return null;

  // 1) Format historique : la ligne « Total des actifs » sert d'ancre.
  const marker = html.search(/Total des actifs/i);
  if (marker >= 0) {
    const chunk = html.slice(marker, marker + 6000);
    const fromCells = totalsFromCells(chunk, usdCadRate);
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
  const labelled = parseDisnatSummaryRows(html, usdCadRate);
  if (labelled.length > 0) return labelled[0];

  // 3) Page d'encaisse sans libellé exploitable : première ligne à identité comptable
  //    (CAD lu en premier quand deux devises sont empilées).
  if (!/liquidit[ée]s/i.test(html) || !/valeur totale/i.test(html)) return null;
  for (const rowMatch of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
    const totals = totalsFromCells(rowMatch[0], usdCadRate);
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
