export type DisnatSummaryTotals = {
  /** Taux (« Taux » colonne 1) — informatif. */
  rate: number | null;
  cashCad: number;
  securitiesCad: number;
  totalCad: number;
};

/** Montant « 1 527,54 CAD » / « 247 530,27 » → nombre. */
function parseMoney(value: string): number | null {
  const cleaned = value
    .replace(/\u00a0/g, " ")
    .replace(/\s*CAD\s*/gi, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Lit la ligne « Total des actifs » du tableau de la page « Vue d'ensemble » :
 * `Total des actifs | 1.3977 | 1 527,54 CAD | 247 530,27 CAD | 249 057,81 CAD`.
 * La page ne contient pas le détail par compte : on rattache ces totaux au **client**
 * (`clientId` de l'URL) pour alimenter l'encaisse aux bornes.
 */
export function parseDisnatSummaryHtml(html: string): DisnatSummaryTotals | null {
  if (!html) return null;
  const marker = html.search(/Total des actifs/i);
  if (marker < 0) return null;
  const chunk = html.slice(marker, marker + 2500);
  const cells = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((cell) => cell.length > 0);

  const numbers = cells
    .map((cell) => ({ text: cell, value: parseMoney(cell) }))
    .filter((entry) => entry.value !== null) as { text: string; value: number }[];
  if (numbers.length < 3) return null;

  // Identité comptable : encaisse + titres = valeur totale. Elle identifie le bon triplet
  // même quand la ligne contient d'autres montants (gain/perte, variation…).
  for (let index = 0; index + 2 < numbers.length; index += 1) {
    const [cashCad, securitiesCad, totalCad] = [
      numbers[index].value,
      numbers[index + 1].value,
      numbers[index + 2].value,
    ];
    if (Math.abs(cashCad + securitiesCad - totalCad) > 1) continue;
    const rateCells = numbers.slice(0, index).filter((entry) => !/CAD/i.test(entry.text));
    return {
      rate: rateCells.length > 0 ? rateCells[rateCells.length - 1].value : null,
      cashCad: Math.round(cashCad * 100) / 100,
      securitiesCad: Math.round(securitiesCad * 100) / 100,
      totalCad: Math.round(totalCad * 100) / 100,
    };
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
