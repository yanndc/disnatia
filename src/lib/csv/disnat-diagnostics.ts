import { clientCodeFromDisnatUrl, extractMoneyValues, stripHtmlTags } from "./disnat-summary";

/**
 * Photographie de ce que contient réellement la page envoyée par le favori.
 * Sert aux messages d'erreur : sans elle, « aucune section trouvée » ne dit pas si la page
 * était la mauvaise, mal rendue, ou si un cadre (iframe) manquait à l'appel.
 */
export type DisnatPageDiagnostics = {
  /** `<title>` de la page, tronqué. */
  title: string | null;
  /** `clientId` de l'URL (ou déduit du HTML). */
  clientId: string | null;
  /** Titres `asset-title` (un par compte dans l'onglet « Historique »). */
  assetTitles: string[];
  /** Nombre de lignes de grille ag-Grid (`row-index=`). */
  gridRows: number;
  /** Texte de la ligne de totaux détectée (« Total des actifs », « Total »…). */
  totalRowLabel: string | null;
  /** Montants lus sur cette ligne de totaux. */
  totalRowValues: number[];
  /** Début du texte visible de la page (pour reconnaître l'onglet ouvert). */
  textSample: string;
  /** Résumé d'une ligne, à coller dans un message d'erreur. */
  hint: string;
};

const MAX_LABEL = 140;
const MAX_SAMPLE = 160;

function pageTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? stripHtmlTags(match[1]) : "";
  return title ? title.slice(0, 100) : null;
}

function assetTitles(html: string): string[] {
  const titles: string[] = [];
  for (const match of html.matchAll(/class=["']asset-title["'][^>]*>([\s\S]*?)</gi)) {
    const title = stripHtmlTags(match[1]);
    if (title && !titles.includes(title)) titles.push(title);
    if (titles.length >= 6) break;
  }
  return titles;
}

/** Première ligne `<tr>` ressemblant à une ligne de totaux, avec ses montants. */
function totalRow(html: string): { label: string; values: number[] } | null {
  for (const match of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
    const text = stripHtmlTags(match[0]);
    if (!/total|vue d['’]?ensemble/i.test(text)) continue;
    const values = extractMoneyValues(text).slice(0, 4);
    if (values.length === 0) continue;
    return { label: text.slice(0, MAX_LABEL), values };
  }
  return null;
}

/** Début du texte visible (hors `<script>`/`<style>`) : identifie l'onglet ouvert. */
function visibleTextSample(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  return stripHtmlTags(cleaned).slice(0, MAX_SAMPLE);
}

/**
 * Décrit la page Disnat reçue (comptes, grille d'historique, ligne de totaux).
 * Aucune valeur n'est écrite en base : c'est uniquement du diagnostic.
 */
export function describeDisnatPage(html: string, url = ""): DisnatPageDiagnostics {
  const titles = assetTitles(html);
  const gridRows = (html.match(/row-index="/g) ?? []).length;
  const totals = totalRow(html);
  const clientId = clientCodeFromDisnatUrl(url);
  const textSample = visibleTextSample(html);

  const parts: string[] = [];
  const title = pageTitle(html);
  if (title) parts.push(`page « ${title} »`);
  if (clientId) parts.push(`client ${clientId}`);
  parts.push(titles.length > 0 ? `${titles.length} section(s) : ${titles.join(" · ")}` : "aucune section de compte");
  parts.push(`grille ${gridRows} ligne(s)`);
  if (totals) {
    parts.push(`totaux « ${totals.label} » → ${totals.values.join(" / ")}`);
  } else {
    parts.push("aucune ligne de totaux");
  }
  if (textSample) parts.push(`texte « ${textSample} »`);

  return {
    title,
    clientId,
    assetTitles: titles,
    gridRows,
    totalRowLabel: totals?.label ?? null,
    totalRowValues: totals?.values ?? [],
    textSample,
    hint: parts.join(" · "),
  };
}
