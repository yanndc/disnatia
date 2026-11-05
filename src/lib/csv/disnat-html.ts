import { normalizeCurrency } from "@/lib/utils";

/**
 * Extraction des transactions depuis la page Disnat sauvegardée
 * (« Détail du compte » → Vue d'ensemble → Historique).
 *
 * La page contient une section par compte (`<div class="asset-title">REER (5KFZEU3)</div>`),
 * chacune avec une grille ag-Grid virtualisée. On lit les cellules `role="gridcell"` par ligne
 * (`row-index="N"`), puis on reconstruit un CSV identique à l'export « Historique des transactions »
 * pour réutiliser le pipeline d'import existant (`/api/imports`).
 */

export const DISNAT_HTML_CSV_HEADERS = [
  "Date de transaction",
  "Date de règlement",
  "Type de transaction",
  "Classe d'actif",
  "Symbole",
  "Description",
  "Marché",
  "Quantité",
  "Prix",
  "Devise du prix",
  "Commission payée",
  "Montant de l'opération",
  "Devise du compte",
] as const;

export type DisnatHtmlRow = {
  tradeDate: string;
  settlementDate: string;
  transactionType: string;
  securityType: string;
  symbol: string;
  description: string;
  quantity: string;
  price: string;
  priceCurrency: string;
  commission: string;
  amount: string;
  accountCurrency: string;
};

export type DisnatHtmlAccount = {
  accountNumber: string;
  accountType: string;
  /** Devise normalisée (CAD/USD) — déduite des lignes. */
  currency: string;
  /** Clé portefeuille `NUM|DEVISE`, identique à `makeAccountKey`. */
  accountKey: string;
  label: string;
  rows: DisnatHtmlRow[];
  fromDate: string | null;
  toDate: string | null;
  /** CSV prêt pour `POST /api/imports` (multipart `file`). */
  csv: string;
};

export type DisnatHtmlParseResult = {
  ok: boolean;
  accounts: DisnatHtmlAccount[];
  rowsTotal: number;
  /** Sections ignorées : agrégat « Vue d'ensemble » ou compte sans transaction sur la période. */
  skipped: { title: string; reason: string; kind: "aggregate" | "empty" }[];
  error?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cellules d'une section : `col-id` → texte. */
function cellsByColumn(sectionHtml: string): Map<string, string> {
  const cells = new Map<string, string>();
  const re =
    /<div[^>]*\brole="gridcell"[^>]*\bcol-id="([A-Za-z]+)"[^>]*>([\s\S]*?)<\/div>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sectionHtml)) !== null) {
    const column = match[1];
    if (!cells.has(column)) cells.set(column, stripTags(match[2]));
  }
  return cells;
}

function csvCell(value: string): string {
  const text = value ?? "";
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(rows: DisnatHtmlRow[]): string {
  const lines = [DISNAT_HTML_CSV_HEADERS.join(";")];
  for (const row of rows) {
    lines.push(
      [
        row.tradeDate,
        row.settlementDate,
        row.transactionType,
        row.securityType,
        row.symbol,
        row.description,
        "-",
        row.quantity,
        row.price,
        row.priceCurrency,
        row.commission,
        row.amount,
        row.accountCurrency,
      ]
        .map((value) => csvCell(value))
        .join(";"),
    );
  }
  return lines.join("\n");
}

/**
 * Découpe la page sauvegardée en comptes + transactions.
 * Fonction pure : aucune I/O, testable avec un fragment HTML.
 */
export function parseDisnatHistoryHtml(html: string): DisnatHtmlParseResult {
  const skipped: { title: string; reason: string; kind: "aggregate" | "empty" }[] = [];
  const accounts: DisnatHtmlAccount[] = [];

  if (!html || html.length < 200) {
    return {
      ok: false,
      accounts,
      rowsTotal: 0,
      skipped,
      error:
        "Contenu vide. Ouvre la page Disnat (Détail du compte → Vue d'ensemble → Historique), puis fais Ctrl+S « Page web, HTML seul » et colle le contenu du fichier.",
    };
  }

  const sections = html.split(/class="asset-title"[^>]*>/);
  if (sections.length < 2) {
    return {
      ok: false,
      accounts,
      rowsTotal: 0,
      skipped,
      error:
        "Aucune section de compte trouvée. Vérifie que la page sauvegardée contient bien l'historique (les titres « REER (5KFZEU3) » par exemple).",
    };
  }

  for (const section of sections.slice(1)) {
    const titleMatch = section.match(/^\s*([^<]+?)\s*</);
    const title = titleMatch ? stripTags(titleMatch[1]) : "Section sans titre";
    const accountMatch = title.match(/^(.*?)\s*\(([A-Za-z0-9]{4,})\)\s*$/);
    if (!accountMatch) {
      skipped.push({ title, reason: "section agrégée (pas un compte)", kind: "aggregate" });
      continue;
    }

    const accountType = accountMatch[1].trim() || "Compte";
    const accountNumber = accountMatch[2].toUpperCase();

    const rows: DisnatHtmlRow[] = [];
    for (const chunk of section.split(/row-index="\d+"/).slice(1)) {
      const cells = cellsByColumn(chunk);
      const tradeDate = cells.get("tradeDate") ?? "";
      const settlementDate = cells.get("settlementDate") ?? "";
      const transactionType = cells.get("transactionType") ?? "";
      const date = ISO_DATE.test(settlementDate)
        ? settlementDate
        : ISO_DATE.test(tradeDate)
          ? tradeDate
          : "";
      if (!date || !transactionType) continue;

      rows.push({
        tradeDate: ISO_DATE.test(tradeDate) ? tradeDate : date,
        settlementDate: ISO_DATE.test(settlementDate) ? settlementDate : date,
        transactionType,
        securityType: cells.get("securityType") ?? "",
        symbol: cells.get("symbol") ?? "",
        description: cells.get("description") ?? "",
        quantity: cells.get("quantity") ?? "",
        price: cells.get("price") ?? "",
        priceCurrency: cells.get("priceCurrency") ?? "",
        commission: cells.get("commission") ?? "",
        amount: cells.get("amount") ?? "",
        accountCurrency: cells.get("accountBundleCurrency") ?? "",
      });
    }

    if (rows.length === 0) {
      skipped.push({ title, reason: "aucune transaction sur la période", kind: "empty" });
      continue;
    }

    const currencyRaw =
      rows.find((row) => row.accountCurrency)?.accountCurrency ??
      rows.find((row) => row.priceCurrency)?.priceCurrency ??
      "CAD";
    const currency = normalizeCurrency(currencyRaw);
    const dates = rows
      .flatMap((row) => [row.settlementDate, row.tradeDate])
      .filter((value) => ISO_DATE.test(value))
      .sort();

    accounts.push({
      accountNumber,
      accountType,
      currency,
      accountKey: `${accountNumber}|${currency}`,
      label: `${accountType} · ${accountNumber} (${currency})`,
      rows,
      fromDate: dates[0] ?? null,
      toDate: dates[dates.length - 1] ?? null,
      csv: buildCsv(rows),
    });
  }

  const rowsTotal = accounts.reduce((sum, account) => sum + account.rows.length, 0);
  return {
    ok: accounts.length > 0,
    accounts,
    rowsTotal,
    skipped,
    error:
      accounts.length > 0
        ? undefined
        : "Aucune transaction trouvée. Vérifie la période sélectionnée dans Disnat avant la sauvegarde.",
  };
}

