/**
 * Parseur RSS 2.0 / RSS 1.0 (RDF) / Atom minimal — sans dépendance externe.
 *
 * Volontairement tolérant : les flux du domaine financier mélangent CDATA, entités HTML,
 * namespaces (`dc:date`, `content:encoded`, `media:content`) et liens portés par attribut
 * (Atom). On extrait uniquement ce dont le fil a besoin et on ignore le reste.
 */

export type FeedEntry = {
  title: string;
  /** URL absolue de l'article (peut être un redirecteur d'agrégateur). */
  url: string;
  guid?: string;
  summary?: string;
  contentHtml?: string;
  publishedAt?: Date;
  author?: string;
  /** Média d'origine (balise `<source>` de Google Actualités). */
  publisher?: string;
  imageUrl?: string;
};

export type ParsedFeed = {
  format: "rss" | "rdf" | "atom" | "unknown";
  feedTitle?: string;
  entries: FeedEntry[];
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  ecirc: "ê",
  ocirc: "ô",
  ugrave: "ù",
  icirc: "î",
  acirc: "â",
  euml: "ë",
  iuml: "ï",
  uuml: "ü",
  auml: "ä",
  ouml: "ö",
  euro: "€",
  deg: "°",
  copy: "©",
  reg: "®",
  trade: "™",
};

/** Décode les entités HTML/XML (numériques puis nommées, `&amp;` en dernier). */
export function decodeEntities(input: string): string {
  let out = input.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) && code > 0 ? safeFromCodePoint(code) : "";
  });
  out = out.replace(/&#(\d+);/g, (_m, dec: string) => {
    const code = Number.parseInt(dec, 10);
    return Number.isFinite(code) && code > 0 ? safeFromCodePoint(code) : "";
  });
  out = out.replace(/&([a-zA-Z][a-zA-Z0-9]{1,10});/g, (match, name: string) => {
    const key = name.toLowerCase();
    if (key === "amp") return match; // décodé à la fin
    return NAMED_ENTITIES[key] ?? match;
  });
  return out.replace(/&amp;/g, "&");
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Contenu d'une balise (première occurrence) dans un bloc XML. */
function tagContent(block: string, names: string[]): string | null {
  for (const name of names) {
    const tag = escapeRegExp(name);
    const match = block.match(
      new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"),
    );
    if (match && typeof match[2] === "string") return match[2];
  }
  return null;
}

/** Valeur d'un attribut sur une balise (ex. `<link href="…"/>`, `<enclosure url="…">`). */
function tagAttribute(block: string, names: string[], attribute: string): string | null {
  for (const name of names) {
    const re = new RegExp(
      `<${escapeRegExp(name)}\\b[^>]*?\\b${escapeRegExp(attribute)}\\s*=\\s*("([^"]*)"|'([^']*)')`,
      "i",
    );
    const match = block.match(re);
    if (match) return decodeEntities(match[2] ?? match[3] ?? "");
  }
  return null;
}

/** Certains flux répètent la même balise (ex. `<category>`) : on renvoie toutes les valeurs. */
export function allTagContents(block: string, name: string): string[] {
  const tag = escapeRegExp(name);
  const out: string[] = [];
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    const value = htmlToText(match[2]);
    if (value) out.push(value);
  }
  return out;
}

/** Parse une date de flux (RFC 822, ISO 8601, variantes RDF `dc:date`). */
export function parseFeedDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = htmlToText(value);
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;
  const normalized = new Date(
    raw.replace(/\s+/g, " ").replace(/^(\d{4}-\d{2}-\d{2})\s+(\d)/, "$1T$2"),
  );
  if (!Number.isNaN(normalized.getTime())) return normalized;
  return null;
}

function atomLink(block: string): string | null {
  // Privilégie rel="alternate" (ou lien sans rel), sinon premier href trouvé.
  const linkTags = block.match(/<link\b[^>]*\/?>/gi) ?? [];
  let fallback: string | null = null;
  for (const tag of linkTags) {
    const hrefMatch = tag.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!hrefMatch) continue;
    const href = decodeEntities(hrefMatch[2] ?? hrefMatch[3] ?? "").trim();
    if (!href) continue;
    const relMatch = tag.match(/\brel\s*=\s*("([^"]*)"|'([^']*)')/i);
    const rel = (relMatch?.[2] ?? relMatch?.[3] ?? "").toLowerCase();
    if (rel === "" || rel === "alternate") return href;
    fallback ??= href;
  }
  return fallback;
}

function rssLink(block: string): string | null {
  const inner = tagContent(block, ["link", "guid"]);
  if (inner) {
    const text = htmlToText(inner);
    if (/^https?:\/\//i.test(text)) return text;
  }
  const href = tagAttribute(block, ["link"], "href");
  if (href && /^https?:\/\//i.test(href)) return href;
  return null;
}

function extractImage(block: string, contentHtml: string | undefined): string | undefined {
  const enclosure = tagAttribute(block, ["enclosure"], "url");
  const enclosureType = tagAttribute(block, ["enclosure"], "type");
  if (enclosure && (!enclosureType || enclosureType.startsWith("image"))) {
    return enclosure;
  }
  const media = tagAttribute(block, ["media:content", "media:thumbnail"], "url");
  if (media) return media;
  if (contentHtml) {
    const img = contentHtml.match(/<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i);
    const src = img?.[2] ?? img?.[3];
    if (src && /^https?:\/\//i.test(src)) return src;
  }
  return undefined;
}

function detectFormat(xml: string): ParsedFeed["format"] {
  if (/<rdf:RDF\b/i.test(xml)) return "rdf";
  if (/<feed\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(xml)) return "atom";
  if (/<rss\b/i.test(xml)) return "rss";
  if (/<feed\b/i.test(xml)) return "atom";
  return "unknown";
}


/** Retire les balises et normalise les espaces d'un fragment HTML (CDATA inclus). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let text = String(html);
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  text = text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  text = text.replace(/<br\s*\/?>/gi, " ");
  text = text.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  return text.replace(/\s+/g, " ").trim();
}

/** Parse un document RSS/Atom complet. */
export function parseFeedXml(xml: string): ParsedFeed {
  const format = detectFormat(xml);
  const channel = xml.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i)?.[1] ?? null;
  const head = channel ?? xml;
  const feedTitle = htmlToText(tagContent(head, ["title"])) || undefined;

  const entries: FeedEntry[] = [];
  const blockRe = /<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(xml)) !== null) {
    const block = match[0];
    const title = htmlToText(tagContent(block, ["title"]));
    const url = (format === "atom" ? atomLink(block) : rssLink(block)) ?? atomLink(block);
    if (!title || !url) continue;

    const contentRaw = tagContent(block, ["content:encoded", "content"]);
    const summaryRaw = tagContent(block, ["description", "summary", "subtitle"]);
    const author = htmlToText(tagContent(block, ["dc:creator", "creator", "author"]));
    const publisher = htmlToText(tagContent(block, ["source", "credit"]));

    entries.push({
      title,
      url,
      guid: htmlToText(tagContent(block, ["guid", "id"])) || undefined,
      summary: summaryRaw === null ? undefined : htmlToText(summaryRaw),
      contentHtml: contentRaw === null ? undefined : htmlToText(contentRaw),
      publishedAt:
        parseFeedDate(
          tagContent(block, ["pubDate", "dc:date", "published", "updated", "date"]),
        ) ?? undefined,
      author: author || undefined,
      publisher: publisher || undefined,
      imageUrl: extractImage(block, contentRaw ?? undefined),
    });
  }

  return { format, feedTitle, entries };
}

